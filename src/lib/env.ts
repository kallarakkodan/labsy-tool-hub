import fs from "node:fs";
import { z } from "zod";

/*
 * The single place `process.env` is read (CONTEXT §3). Everything else imports
 * `getEnv()`.
 *
 * The contract is that a misconfigured service refuses to start, loudly, with a
 * message naming what to fix — rather than starting and failing on the first
 * download at 2am. `assertEnv()` in src/instrumentation.ts is what enforces it;
 * `parseEnv()` is kept pure so the rules are testable without exiting the runner.
 */

/** `"true"` / `"false"` with a fallback, avoiding Zod's default()/prefault() nuances. */
const booleanish = (fallback: boolean) =>
  z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? fallback : v === "true"));

const positiveInt = (fallback: number) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : Number(v)))
    .pipe(z.number().int().positive());

const stringWithDefault = (fallback: string) =>
  z
    .string()
    .optional()
    .transform((v) => (v === undefined || v === "" ? fallback : v));

/** AUTH_SECRET is measured in bytes, not characters — CONTEXT §3 says ">=32 random bytes". */
const MIN_AUTH_SECRET_BYTES = 32;

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).optional().transform((v) => v ?? "development"),

  // --- Core ---
  DATABASE_URL: z.string().min(1, "required — e.g. file:./prisma/dev.db"),
  STORAGE_ROOT: z.string().min(1, "required — the directory tree this app may read"),
  NEXT_PUBLIC_APP_VERSION: stringWithDefault("0.0.0"),

  // --- Auth ---
  ADMIN_PASSWORD_HASH: z.string().min(1, "empty — generate one with `pnpm gen:hash`"),
  AUTH_SECRET: z
    .string()
    .refine(
      (s) => Buffer.byteLength(s, "utf8") >= MIN_AUTH_SECRET_BYTES,
      `must be at least ${MIN_AUTH_SECRET_BYTES} bytes — generate one with \`openssl rand -base64 48\``,
    ),
  SESSION_TTL_HOURS: positiveInt(8),
  COOKIE_SECURE: booleanish(true),

  // --- Uploads ---
  CHUNK_SIZE: positiveInt(16_777_216),
  UPLOAD_SUBDIR: stringWithDefault("uploads"),
  UPLOAD_TTL_HOURS: positiveInt(24),

  // --- Serving ---
  USE_X_ACCEL: booleanish(false),
  X_ACCEL_PREFIX: stringWithDefault("/_protected").pipe(
    z.string().startsWith("/", "must start with / and match the proxy's `internal` location"),
  ),
});

export type Env = Readonly<z.infer<typeof schema>>;

export class EnvError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "EnvError";
  }
}

/** A raw environment. Deliberately not `NodeJS.ProcessEnv`, whose required NODE_ENV makes partial fixtures unrepresentable. */
export type EnvSource = Record<string, string | undefined>;

export interface ParseEnvOptions {
  /**
   * Whether to stat STORAGE_ROOT. Off during `next build`, where the production
   * storage root does not exist on the build machine and the check would fail a
   * CI build for a condition that only matters at runtime.
   */
  checkFilesystem?: boolean;
}

export function parseEnv(source: EnvSource, options: ParseEnvOptions = {}): Env {
  const { checkFilesystem = true } = options;

  const result = schema.safeParse(source);
  const problems: string[] = [];

  if (!result.success) {
    for (const issue of result.error.issues) {
      problems.push(`${issue.path.join(".") || "(root)"}: ${issue.message}`);
    }
    // Cross-field checks below need parsed values, so stop here if they are missing.
    throw new EnvError(problems);
  }

  const env = result.data;

  // A Secure cookie over plain HTTP is silently discarded by the browser: login
  // appears to succeed and never sticks (PRD §12.5). Refuse to start instead.
  if (env.NODE_ENV === "production" && !env.COOKIE_SECURE) {
    problems.push(
      "COOKIE_SECURE: cannot be false when NODE_ENV=production — the browser would discard the session cookie and login would silently never stick",
    );
  }

  if (env.USE_X_ACCEL && !env.X_ACCEL_PREFIX) {
    problems.push("X_ACCEL_PREFIX: required when USE_X_ACCEL=true");
  }

  if (checkFilesystem) {
    problems.push(...checkStorageRoot(env.STORAGE_ROOT));
  }

  if (problems.length > 0) throw new EnvError(problems);

  return Object.freeze(env);
}

/**
 * D2's whole point is that "the file is there but the app can't read it" should be
 * structurally impossible. That starts with refusing to boot when the root is
 * missing or unreadable, rather than discovering it on the first download.
 */
function checkStorageRoot(root: string): string[] {
  let stat: fs.Stats;
  try {
    stat = fs.statSync(root);
  } catch {
    return [`STORAGE_ROOT: "${root}" does not exist — create it, or point at a directory that does`];
  }

  if (!stat.isDirectory()) {
    return [`STORAGE_ROOT: "${root}" is not a directory`];
  }

  try {
    fs.accessSync(root, fs.constants.R_OK | fs.constants.X_OK);
  } catch {
    return [
      `STORAGE_ROOT: "${root}" is not readable by this user — check the default ACLs from PRD §12.2 (\`setfacl -R -d -m g:labsy:rX\`)`,
    ];
  }

  return [];
}

let cached: Env | null = null;

/** The parsed environment. Memoised; throws `EnvError` if the environment is invalid. */
export function getEnv(): Env {
  if (cached === null) {
    cached = parseEnv(process.env, {
      checkFilesystem: process.env.NEXT_PHASE !== "phase-production-build",
    });
  }
  return cached;
}

/**
 * Boot gate, called from src/instrumentation.ts. Prints every problem at once —
 * fixing one variable per restart is a miserable way to bring a service up — and
 * exits non-zero so systemd's `Restart=always` surfaces it in the journal.
 */
export function assertEnv(): void {
  try {
    getEnv();
  } catch (error) {
    if (!(error instanceof EnvError)) throw error;

    console.error("\n  Labsy Tool Hub cannot start — the environment is invalid.\n");
    for (const problem of error.problems) console.error(`    ✗ ${problem}`);
    console.error("\n  See .env.example and CONTEXT §3. Values live in .env.local (dev) or /etc/labsy-hub/env (prod).\n");

    process.exit(1);
  }
}

/** Test seam: forget the memoised value so a suite can parse a different environment. */
export function resetEnvCache(): void {
  cached = null;
}
