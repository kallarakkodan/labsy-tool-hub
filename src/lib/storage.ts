import path from "node:path";
import fs from "node:fs/promises";
import { getEnv } from "@/lib/env";

/*
 * The filesystem security boundary (PRD §11.1, CONTEXT §7.1).
 *
 * Every filesystem operation in this application goes through this module. No
 * route handler calls `fs` directly — a bare `fs.readdir(userInput)` anywhere
 * else is an automatic PR rejection (CONTEXT §2 item 2), because the moment
 * path resolution exists in two places, only one of them gets audited.
 *
 * What this module does NOT do, deliberately:
 *
 *   - It does not percent-decode. Query strings arrive already decoded by the
 *     URL layer; decoding again here would turn `%252e%252e%252f` into `../`
 *     and hand an attacker the escape this module exists to prevent.
 *   - It does not consult the database. `Tool.filePath` is re-validated through
 *     `resolveWithinRoot` on every download (PRD §9.4 step 2) — the DB is not
 *     a trusted source of paths.
 */

export type PathErrorCode = "INVALID_PATH" | "PATH_OUTSIDE_ROOT" | "NOT_FOUND" | "NOT_A_DIRECTORY" | "EACCES";

export class PathError extends Error {
  constructor(
    readonly code: PathErrorCode,
    msg: string,
  ) {
    super(msg);
    this.name = "PathError";
  }
}

/** PRD §9.3 step 1. Longer than any real path; a 5000-char string is an attack, not a filename. */
const MAX_PATH_LENGTH = 4096;

/** PRD §9.3: directory listings are capped, with a flag, rather than streaming 200k entries into a modal. */
const MAX_ENTRIES = 5000;

/** Chunk temp storage. Never listed — it is internal, and PRD §14 requires it stay invisible. */
const INTERNAL_UPLOAD_DIR = ".uploads";

let rootCache: { configured: string; real: string } | null = null;

/**
 * The storage root, fully resolved. Cached per configured value, so a test that
 * repoints `STORAGE_ROOT` gets the new root without a bespoke reset hook.
 */
export async function getRoot(): Promise<string> {
  const configured = getEnv().STORAGE_ROOT;
  if (rootCache?.configured === configured) return rootCache.real;

  const real = await fs.realpath(configured);
  rootCache = { configured, real };
  return real;
}

/**
 * Resolve a client-supplied relative path to an absolute path guaranteed to sit
 * under STORAGE_ROOT. This is the choke point every attack in PRD §11.1 has to
 * get through.
 *
 * The target must exist; use `resolveForWrite` for a path being created.
 */
export async function resolveWithinRoot(relative: string): Promise<string> {
  const root = await getRoot();
  const target = joinWithinRoot(root, relative);

  // realpath is what defeats symlinks — a string check cannot see through one.
  let real: string;
  try {
    real = await fs.realpath(target);
  } catch (error) {
    throw fromFsError(error, relative);
  }

  assertContained(real, root);
  return real;
}

/**
 * Resolve a path that does not exist yet — an upload's destination file.
 *
 * The parent directory must exist and must be inside the root; the basename is
 * then appended. Resolving the parent is what matters: if the parent is a
 * symlink pointing outside the root, `realpath` sees it and this rejects.
 *
 * Not in the original issue scope, but uploads need it (issues 28 and 30), and
 * the alternative is upload code hand-rolling its own path logic outside the
 * one module that gets audited.
 */
export async function resolveForWrite(relative: string): Promise<string> {
  const root = await getRoot();
  const target = joinWithinRoot(root, relative);

  const parent = path.dirname(target);
  const base = path.basename(target);

  if (base === "" || base === "." || base === "..") {
    throw new PathError("INVALID_PATH", "Path does not name a file");
  }

  let realParent: string;
  try {
    realParent = await fs.realpath(parent);
  } catch (error) {
    throw fromFsError(error, relative);
  }

  assertContained(realParent, root);

  const resolved = path.join(realParent, base);
  assertContained(resolved, root);
  return resolved;
}

/**
 * Re-validate an **absolute** path already stored in the database (PRD §9.4
 * step 2: "the DB is not trusted").
 *
 * Distinct from `resolveWithinRoot`, which anchors a *client-supplied relative*
 * path at the root. Do not reach this by relativising and re-resolving: the
 * stored path may contain a symlinked prefix that the root's realpath does not
 * — `/var` vs `/private/var` on macOS is the everyday example — and
 * `path.relative` between the two produces a `../../..` escape that then fails
 * to resolve. Realpath both sides and compare, which is what this does.
 *
 * Errors name only the basename; the caller already has the row, and the full
 * host path must not reach a log line that might be surfaced (CONTEXT §2 item 5).
 */
export async function resolveStoredPath(absolute: string): Promise<string> {
  if (absolute.includes("\0")) {
    throw new PathError("INVALID_PATH", "Invalid stored path");
  }
  if (absolute.length > MAX_PATH_LENGTH) {
    throw new PathError("INVALID_PATH", "Stored path too long");
  }

  const root = await getRoot();

  let real: string;
  try {
    real = await fs.realpath(absolute);
  } catch (error) {
    throw fromFsError(error, path.basename(absolute));
  }

  assertContained(real, root);
  return real;
}

/** Absolute path -> path relative to the root, for sending to the client. */
export async function toRelative(absolute: string): Promise<string> {
  return path.relative(await getRoot(), absolute);
}

export interface DirectoryEntry {
  name: string;
  type: "dir" | "file";
  /** Bytes as a decimal string for files (BigInt boundary), null for directories. */
  size: string | null;
  mtime: string;
  ext?: string;
}

export interface DirectoryListing {
  path: string;
  parent: string | null;
  entries: DirectoryEntry[];
  truncated: boolean;
}

/**
 * List a directory under the root (PRD §9.3 steps 6–7).
 *
 * `.uploads` is filtered here rather than at the call site — a caller that
 * forgets is a caller that exposes chunk temp files, and there is exactly one
 * place to forget if the filter lives here.
 */
export async function listDirectory(
  relative = "",
  options: { showHidden?: boolean } = {},
): Promise<DirectoryListing> {
  const { showHidden = false } = options;

  const root = await getRoot();
  const dir = await resolveWithinRoot(relative);

  const stat = await lstatOrThrow(dir, relative);
  if (!stat.isDirectory()) {
    throw new PathError("NOT_A_DIRECTORY", "Path is not a directory");
  }

  let dirents;
  try {
    dirents = await fs.readdir(dir, { withFileTypes: true });
  } catch (error) {
    throw fromFsError(error, relative);
  }

  const truncated = dirents.length > MAX_ENTRIES;
  const entries: DirectoryEntry[] = [];

  for (const dirent of dirents.slice(0, MAX_ENTRIES)) {
    const entry = await describeEntry(dir, dirent.name, root, showHidden);
    if (entry !== null) entries.push(entry);
  }

  entries.sort(compareEntries);

  const normalized = await toRelative(dir);
  return {
    path: normalized,
    parent: normalized === "" ? null : path.dirname(normalized) === "." ? "" : path.dirname(normalized),
    entries,
    truncated,
  };
}

export interface FileStat {
  /** Path relative to the root — never the absolute host path. */
  path: string;
  name: string;
  size: bigint;
  mtime: Date;
}

/** Stat a regular file under the root. Directories are rejected, not described. */
export async function statFile(relative: string): Promise<FileStat> {
  const resolved = await resolveWithinRoot(relative);
  const stat = await lstatOrThrow(resolved, relative);

  if (!stat.isFile()) {
    throw new PathError("INVALID_PATH", "Path is not a regular file");
  }

  return {
    path: await toRelative(resolved),
    name: path.basename(resolved),
    size: BigInt(stat.size),
    mtime: stat.mtime,
  };
}

// --- internals ---------------------------------------------------------------

/**
 * PRD §9.3 steps 1–3: reject the obviously hostile, then neutralise leading `..`
 * before resolution.
 *
 * `normalize("/" + p).slice(1)` is the trick: anchoring at `/` makes `../../etc`
 * collapse to `etc` rather than climbing out, so the subsequent `resolve` cannot
 * be walked above the root by the string alone.
 */
function joinWithinRoot(root: string, relative: string): string {
  if (relative.includes("\0")) {
    throw new PathError("INVALID_PATH", "Invalid path");
  }
  if (relative.length > MAX_PATH_LENGTH) {
    throw new PathError("INVALID_PATH", "Path too long");
  }

  // Backslashes are folded to separators, per CONTEXT §7.1.
  //
  // Be clear about what this does and does not buy on this deployment: on Linux
  // a backslash is a legal filename character, so `..\..\windows\system32` is
  // already just one harmless segment that resolves inside the root and 404s.
  // Removing this line fails no test. It is kept as defence for the case where
  // the root ever sits on a filesystem that treats `\` as a separator — not
  // because it is currently load-bearing. The cost is that a POSIX file whose
  // name genuinely contains a backslash becomes unaddressable, which is fine.
  const safeRelative = path.normalize("/" + relative.replace(/\\/g, "/")).slice(1);
  return path.resolve(root, safeRelative);
}

/**
 * The containment check. `real === root ||` plus `path.sep` is load-bearing:
 * a bare `startsWith(root)` accepts `/srv/downloads-evil`, which is a sibling
 * directory an attacker may well be able to create.
 */
function assertContained(candidate: string, root: string): void {
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    throw new PathError("PATH_OUTSIDE_ROOT", "Path is outside the storage root");
  }
}

async function lstatOrThrow(absolute: string, relative: string) {
  try {
    return await fs.lstat(absolute);
  } catch (error) {
    throw fromFsError(error, relative);
  }
}

/**
 * Translate an fs error without leaking it. The raw message contains the
 * absolute host path (CONTEXT §2 item 5, PRD §11.2), so only the relative path
 * the caller already knows is echoed back.
 */
function fromFsError(error: unknown, relative: string): PathError {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;

  if (code === "EACCES" || code === "EPERM") {
    return new PathError("EACCES", `Permission denied reading "${relative || "storage"}"`);
  }
  if (code === "ENOTDIR") {
    return new PathError("NOT_A_DIRECTORY", "Path is not a directory");
  }
  if (code === "ENAMETOOLONG") {
    return new PathError("INVALID_PATH", "Path too long");
  }
  return new PathError("NOT_FOUND", "Path does not exist");
}

/**
 * Describe one directory entry, or null if it must not be listed.
 *
 * Symlinks are followed only to decide whether they escape: one pointing outside
 * the root is skipped entirely rather than reported, so the listing cannot be
 * used to probe for the existence of files elsewhere on the host.
 */
async function describeEntry(
  dir: string,
  name: string,
  root: string,
  showHidden: boolean,
): Promise<DirectoryEntry | null> {
  if (name === INTERNAL_UPLOAD_DIR) return null;
  if (!showHidden && name.startsWith(".")) return null;

  const absolute = path.join(dir, name);

  let stat;
  try {
    stat = await fs.lstat(absolute);
  } catch {
    return null; // vanished between readdir and lstat; not worth failing the listing
  }

  if (stat.isSymbolicLink()) {
    let real: string;
    try {
      real = await fs.realpath(absolute);
    } catch {
      return null; // broken symlink
    }
    if (real !== root && !real.startsWith(root + path.sep)) return null;

    try {
      stat = await fs.stat(absolute);
    } catch {
      return null;
    }
  }

  if (stat.isDirectory()) {
    return { name, type: "dir", size: null, mtime: stat.mtime.toISOString() };
  }
  if (!stat.isFile()) {
    return null; // sockets, fifos, devices — not distributable artifacts
  }

  return {
    name,
    type: "file",
    size: BigInt(stat.size).toString(),
    mtime: stat.mtime.toISOString(),
    ext: path.extname(name).toLowerCase() || undefined,
  };
}

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

/** Directories first, then files, each alphabetical (PRD §8.4). */
function compareEntries(a: DirectoryEntry, b: DirectoryEntry): number {
  if (a.type !== b.type) return a.type === "dir" ? -1 : 1;
  return collator.compare(a.name, b.name);
}
