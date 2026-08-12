import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";
import { PrismaClient } from "@/generated/prisma/client";
import type { Prisma } from "@/generated/prisma/client";
import { getEnv } from "@/lib/env";

/*
 * The Prisma singleton and the one place tool visibility is decided.
 *
 * These live together because every read path needs both, and keeping
 * `toolVisibilityWhere` next to the client makes it hard to write a query
 * without noticing it.
 */

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

/**
 * Prisma 7 requires a driver adapter; there is no built-in connector any more.
 * `better-sqlite3` is the synchronous, in-process one — no daemon, which is the
 * whole reason SQLite was chosen (PRD §4).
 *
 * `timeout` is better-sqlite3's name for `busy_timeout`, and it is per
 * connection, so it belongs here. It turns a lock collision into a short wait
 * rather than an immediate SQLITE_BUSY.
 *
 * WAL is *not* set here — see `ensureWal()`.
 */
export function createPrismaClient(url?: string): PrismaClient {
  const adapter = new PrismaBetterSqlite3({
    url: url ?? getEnv().DATABASE_URL,
    timeout: 5_000,
  });

  return new PrismaClient({ adapter });
}

/**
 * Switch the database to WAL, which lets the catalogue be read while a download
 * bumps `downloadCount` instead of the two blocking each other.
 *
 * Unlike `busy_timeout`, `journal_mode` is a **property of the database file**,
 * not of the connection: it is written into the file header and every later
 * connection inherits it. So this runs once at boot (from instrumentation) and
 * is effectively idempotent — but it must actually run at least once, because
 * better-sqlite3 opens new databases in `delete` mode, not WAL.
 */
export async function ensureWal(client: PrismaClient = prisma): Promise<string> {
  const [{ journal_mode }] = await client.$queryRawUnsafe<{ journal_mode: string }[]>(
    "PRAGMA journal_mode=WAL",
  );
  return journal_mode;
}

/**
 * Without the globalThis guard, dev hot-reload constructs a new client on every
 * edit and exhausts connections within a few saves.
 */
export function getPrisma(): PrismaClient {
  globalForPrisma.prisma ??= createPrismaClient();
  return globalForPrisma.prisma;
}

/**
 * The client every call site uses: `prisma.tool.findMany(...)`.
 *
 * It is a lazy proxy rather than an eagerly constructed instance so that
 * importing this module has no side effects. An eager `new PrismaClient()` at
 * module scope would call `getEnv()` on import, which means any test — or any
 * script — that touches something adjacent to the data layer would need a
 * complete, valid environment before it could even load the file.
 */
export const prisma: PrismaClient = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getPrisma();
    const value = Reflect.get(client, property) as unknown;
    // Bind so the real client stays `this`; forwarding the proxy breaks Prisma's internals.
    return typeof value === "function" ? value.bind(client) : value;
  },
});

/**
 * The ONLY place tool visibility is decided. Every read path — public API, RSC
 * page, download handler, detail drawer, sitemap, search — passes its result
 * into `where`.
 *
 * Two independent axes, which are easy to conflate and must not be:
 *   `published`  — is it ready?           (false = Draft)
 *   `visibility` — is it for everyone?    ("admin" = Internal)
 *
 * Spread it FIRST so a later key cannot accidentally override it:
 *
 *     where: { ...toolVisibilityWhere(isAdmin), ...otherFilters }
 *
 * When a lookup misses, return 404 — never 403. A 403 confirms to an anonymous
 * visitor that an internal tool by that name exists.
 */
export function toolVisibilityWhere(isAdmin: boolean): Prisma.ToolWhereInput {
  if (isAdmin) return {}; // admins see drafts and internal tools
  return { published: true, visibility: "public" };
}
