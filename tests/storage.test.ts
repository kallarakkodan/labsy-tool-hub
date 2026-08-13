import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import {
  PathError,
  createUploadDir,
  getRoot,
  listDirectory,
  removeUploadDir,
  resolveForWrite,
  resolveStoredPath,
  resolveWithinRoot,
  statFile,
  toRelative,
} from "../src/lib/storage";

/*
 * PRD §11.1's attack table, every row, against a real fixture tree — with a real
 * escaping symlink and a real `-evil` sibling directory. Asserting against
 * strings would not exercise `realpath`, which is the only thing that actually
 * defeats a symlink.
 *
 * This file is what `pnpm test:security` runs. It gates P3.
 */

let base: string;
let root: string;
let evilSibling: string;

/** Assert a call rejects with a PathError carrying the expected code. */
async function expectPathError(promise: Promise<unknown>, code: PathError["code"]) {
  await expect(promise).rejects.toBeInstanceOf(PathError);
  await expect(promise).rejects.toMatchObject({ code });
}

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "labsy-storage-"));

  root = join(base, "downloads");
  mkdirSync(root);

  // Prefix confusion: a sibling whose path starts with the root's path.
  evilSibling = `${root}-evil`;
  mkdirSync(evilSibling);
  writeFileSync(join(evilSibling, "secrets.txt"), "should never be reachable");

  mkdirSync(join(root, "isos"));
  mkdirSync(join(root, "uploads")); // UPLOAD_SUBDIR — destination for completed uploads
  mkdirSync(join(root, "isos", "ubuntu"));
  writeFileSync(join(root, "isos", "ubuntu-22.04.4-live-server-amd64.iso"), "x".repeat(2048));
  writeFileSync(join(root, "isos", "ubuntu", "jammy.txt"), "x");
  writeFileSync(join(root, "labsy-deployer.zip"), "x".repeat(512));
  writeFileSync(join(root, ".hidden-notes"), "x");

  // The internal chunk directory must never appear in a listing.
  mkdirSync(join(root, ".uploads"));
  writeFileSync(join(root, ".uploads", "0.part"), "x");

  // A real symlink pointing outside the root, and one pointing inside it.
  symlinkSync(evilSibling, join(root, "escape-link"));
  symlinkSync(join(root, "isos"), join(root, "inside-link"));
  symlinkSync(join(base, "nowhere"), join(root, "broken-link"));

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = "file:./test.db";
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.AUTH_SECRET = "x".repeat(32);
  resetEnvCache();

  await getRoot();
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

describe("PRD §11.1 attack table", () => {
  it("rejects a relative escape", async () => {
    await expectPathError(resolveWithinRoot("../../etc/passwd"), "NOT_FOUND");
  });

  it("rejects a relative escape that would land on a real file", async () => {
    // `../downloads-evil/secrets.txt` really exists, so this is the case where a
    // string-only defence would succeed in reading it.
    await expectPathError(resolveWithinRoot("../downloads-evil/secrets.txt"), "NOT_FOUND");
  });

  it("rejects a percent-encoded escape", async () => {
    // Arrives here already decoded by the URL layer, so this is the literal form.
    await expectPathError(resolveWithinRoot("%2e%2e%2f%2e%2e%2fetc/passwd"), "NOT_FOUND");
  });

  it("rejects a double-encoded escape without decoding it a second time", async () => {
    await expectPathError(resolveWithinRoot("%252e%252e%252f"), "NOT_FOUND");
  });

  it("rejects an absolute path", async () => {
    await expectPathError(resolveWithinRoot("/etc/shadow"), "NOT_FOUND");
  });

  it("neutralises an absolute path that exists, rather than reading it", async () => {
    // "/etc/hosts" exists on every host this runs on. Anchoring at the root
    // turns it into <root>/etc/hosts, which does not.
    await expectPathError(resolveWithinRoot("/etc/hosts"), "NOT_FOUND");
  });

  it("rejects a null byte", async () => {
    await expectPathError(resolveWithinRoot("foo\0.iso"), "INVALID_PATH");
  });

  it("rejects a symlink escaping the root", async () => {
    await expectPathError(resolveWithinRoot("escape-link"), "PATH_OUTSIDE_ROOT");
  });

  it("rejects a file reached through an escaping symlink", async () => {
    await expectPathError(resolveWithinRoot("escape-link/secrets.txt"), "PATH_OUTSIDE_ROOT");
  });

  it("rejects prefix confusion — the sibling directory sharing the root's prefix", async () => {
    // The check is `real === root || real.startsWith(root + sep)`. A bare
    // startsWith(root) would accept this path.
    await expectPathError(resolveWithinRoot(`..${sep}downloads-evil`), "NOT_FOUND");
  });

  it("rejects Windows separators used as an escape", async () => {
    await expectPathError(resolveWithinRoot("..\\..\\windows\\system32"), "NOT_FOUND");
  });

  it("rejects an overlong path", async () => {
    await expectPathError(resolveWithinRoot("a".repeat(5000)), "INVALID_PATH");
  });
});

describe("the containment check itself", () => {
  it("treats the sibling directory as outside, proving startsWith(root) alone is insufficient", async () => {
    // Reach the sibling by its real absolute path via a symlink, which is the
    // only way to get a resolved path that literally starts with the root string.
    await expectPathError(resolveWithinRoot("escape-link"), "PATH_OUTSIDE_ROOT");

    const real = await getRoot();
    const realEvil = await realpath(evilSibling);
    expect(realEvil.startsWith(real)).toBe(true); // the trap a bare startsWith falls into
    expect(realEvil.startsWith(real + sep)).toBe(false); // the defence
  });
});

describe("legitimate paths", () => {
  it("resolves a file", async () => {
    const resolved = await resolveWithinRoot("isos/ubuntu-22.04.4-live-server-amd64.iso");
    expect(resolved).toBe(join(await getRoot(), "isos/ubuntu-22.04.4-live-server-amd64.iso"));
  });

  it("resolves the root itself", async () => {
    expect(await resolveWithinRoot("")).toBe(await getRoot());
  });

  it("follows a symlink that stays inside the root", async () => {
    expect(await resolveWithinRoot("inside-link")).toBe(join(await getRoot(), "isos"));
  });

  it("tolerates redundant segments", async () => {
    const resolved = await resolveWithinRoot("./isos/../isos/ubuntu");
    expect(resolved).toBe(join(await getRoot(), "isos/ubuntu"));
  });

  it("round-trips through toRelative", async () => {
    const absolute = await resolveWithinRoot("isos/ubuntu");
    expect(await toRelative(absolute)).toBe(join("isos", "ubuntu"));
  });
});

describe("listDirectory", () => {
  it("never lists the internal .uploads directory, even with hidden files shown", async () => {
    const listing = await listDirectory("", { showHidden: true });
    expect(listing.entries.map((e) => e.name)).not.toContain(".uploads");
  });

  it("hides dotfiles by default and reveals them on request", async () => {
    const hidden = await listDirectory("");
    expect(hidden.entries.map((e) => e.name)).not.toContain(".hidden-notes");

    const shown = await listDirectory("", { showHidden: true });
    expect(shown.entries.map((e) => e.name)).toContain(".hidden-notes");
  });

  it("omits a symlink pointing outside the root instead of reporting it", async () => {
    const listing = await listDirectory("");
    expect(listing.entries.map((e) => e.name)).not.toContain("escape-link");
  });

  it("omits a broken symlink", async () => {
    const listing = await listDirectory("");
    expect(listing.entries.map((e) => e.name)).not.toContain("broken-link");
  });

  it("includes a symlink that stays inside the root", async () => {
    const listing = await listDirectory("");
    const link = listing.entries.find((e) => e.name === "inside-link");
    expect(link?.type).toBe("dir");
  });

  it("sorts directories before files, each alphabetically", async () => {
    const listing = await listDirectory("");
    const types = listing.entries.map((e) => e.type);
    expect(types).toEqual([...types].sort((a, b) => (a === b ? 0 : a === "dir" ? -1 : 1)));
  });

  it("reports sizes as strings and directories as null", async () => {
    const listing = await listDirectory("isos");
    const iso = listing.entries.find((e) => e.name.endsWith(".iso"));
    const dir = listing.entries.find((e) => e.name === "ubuntu");

    expect(iso).toMatchObject({ type: "file", size: "2048", ext: ".iso" });
    expect(dir).toMatchObject({ type: "dir", size: null });
  });

  it("gives the root no parent, and a subdirectory the right one", async () => {
    expect((await listDirectory("")).parent).toBeNull();
    expect((await listDirectory("isos")).parent).toBe("");
    expect((await listDirectory("isos/ubuntu")).parent).toBe("isos");
  });

  it("refuses to list a file", async () => {
    await expectPathError(listDirectory("labsy-deployer.zip"), "NOT_A_DIRECTORY");
  });

  it("reports a permission error naming the relative directory, not the host path", async () => {
    const locked = join(root, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);
    try {
      await expect(listDirectory("locked")).rejects.toMatchObject({ code: "EACCES" });
      await expect(listDirectory("locked")).rejects.toThrow(/locked/);
      await expect(listDirectory("locked")).rejects.not.toThrow(new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    } finally {
      chmodSync(locked, 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });

  it("caps a large directory and flags it", async () => {
    const big = join(root, "big");
    mkdirSync(big, { recursive: true });
    for (let i = 0; i < 5010; i++) writeFileSync(join(big, `f${i}.bin`), "");
    try {
      const listing = await listDirectory("big");
      expect(listing.entries).toHaveLength(5000);
      expect(listing.truncated).toBe(true);
    } finally {
      rmSync(big, { recursive: true, force: true });
    }
  });
});

describe("statFile", () => {
  it("describes a file without exposing the host path", async () => {
    const stat = await statFile("isos/ubuntu-22.04.4-live-server-amd64.iso");

    expect(stat.size).toBe(2048n);
    expect(stat.name).toBe("ubuntu-22.04.4-live-server-amd64.iso");
    expect(stat.path).toBe(join("isos", "ubuntu-22.04.4-live-server-amd64.iso"));
    expect(stat.path.startsWith("/")).toBe(false);
  });

  it("refuses a directory", async () => {
    await expectPathError(statFile("isos"), "INVALID_PATH");
  });

  it("refuses a path outside the root", async () => {
    await expectPathError(statFile("escape-link/secrets.txt"), "PATH_OUTSIDE_ROOT");
  });
});

describe("resolveForWrite", () => {
  it("resolves a destination that does not exist yet", async () => {
    const resolved = await resolveForWrite("uploads/new-file.zip");
    expect(resolved).toBe(join(await getRoot(), "uploads/new-file.zip"));
  });

  it("rejects when the parent directory does not exist", async () => {
    await expectPathError(resolveForWrite("no-such-dir/new-file.zip"), "NOT_FOUND");
  });

  it("rejects a destination whose parent symlinks outside the root", async () => {
    await expectPathError(resolveForWrite("escape-link/new-file.zip"), "PATH_OUTSIDE_ROOT");
  });

  it("rejects a traversal in the destination", async () => {
    await expectPathError(resolveForWrite("../downloads-evil/new-file.zip"), "NOT_FOUND");
  });

  it("refuses to treat the storage root itself as a writable destination", async () => {
    await expectPathError(resolveForWrite(""), "PATH_OUTSIDE_ROOT");
    await expectPathError(resolveForWrite("."), "PATH_OUTSIDE_ROOT");
  });

  it("rejects a null byte", async () => {
    await expectPathError(resolveForWrite("uploads/new\0.zip"), "INVALID_PATH");
  });
});

describe("resolveStoredPath", () => {
  it("accepts a stored path inside the root", async () => {
    const stored = join(root, "isos", "ubuntu-22.04.4-live-server-amd64.iso");
    expect(await resolveStoredPath(stored)).toBe(join(await getRoot(), "isos/ubuntu-22.04.4-live-server-amd64.iso"));
  });

  it("accepts a root whose prefix is symlinked, which relativising would break", async () => {
    // On macOS the temp root is /var/... while its realpath is /private/var/...
    // path.relative between the two yields a ../../.. escape; realpath does not.
    const stored = join(base, "downloads", "labsy-deployer.zip");
    await expect(resolveStoredPath(stored)).resolves.toContain("labsy-deployer.zip");
  });

  it("refuses a stored path outside the root even though the file exists", async () => {
    await expectPathError(resolveStoredPath(join(evilSibling, "secrets.txt")), "PATH_OUTSIDE_ROOT");
  });

  it("refuses a stored path reached through an escaping symlink", async () => {
    await expectPathError(resolveStoredPath(join(root, "escape-link", "secrets.txt")), "PATH_OUTSIDE_ROOT");
  });

  it("reports a deleted file as NOT_FOUND so the caller can flag it", async () => {
    await expectPathError(resolveStoredPath(join(root, "isos", "never-existed.iso")), "NOT_FOUND");
  });

  it("names only the basename in the error, never the host path", async () => {
    await expect(resolveStoredPath(join(root, "isos", "never-existed.iso"))).rejects.not.toThrow(
      new RegExp(root.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
    );
  });

  it("rejects a null byte", async () => {
    await expectPathError(resolveStoredPath(join(root, "a\u0000.iso")), "INVALID_PATH");
  });
});

describe("createUploadDir / removeUploadDir (issue 28)", () => {
  it("creates .uploads/<id> and removeUploadDir deletes exactly that directory", async () => {
    const dir = await createUploadDir("upload-abc");
    expect(existsSync(dir)).toBe(true);
    expect(dir).toBe(join(await getRoot(), ".uploads", "upload-abc"));

    await removeUploadDir(dir);
    expect(existsSync(dir)).toBe(false);
  });

  it("tolerates removing an already-gone directory", async () => {
    const dir = join(await getRoot(), ".uploads", "never-existed");
    await expect(removeUploadDir(dir)).resolves.toBeUndefined();
  });

  /*
   * The regression this guards: a bare `startsWith(uploadsRoot)` string check
   * accepts `<root>/.uploads/x/../../../etc/passwd` — it literally starts with
   * the prefix — while resolving to well outside `.uploads`. A corrupted or
   * hand-edited `Upload.tempDir` must not be able to smuggle a janitor sweep or
   * a cancel into deleting an arbitrary directory this way.
   */
  it("refuses a tempDir value that resolves outside .uploads via a smuggled ..", async () => {
    const smuggled = join(await getRoot(), ".uploads", "x", "..", "..", "..", "isos");
    expect(existsSync(join(await getRoot(), "isos"))).toBe(true);

    await expectPathError(removeUploadDir(smuggled), "PATH_OUTSIDE_ROOT");
    expect(existsSync(join(await getRoot(), "isos"))).toBe(true);
  });

  it("refuses prefix confusion — a sibling directory sharing .uploads' name as a prefix", async () => {
    await expectPathError(
      removeUploadDir(join(await getRoot(), ".uploads-evil")),
      "PATH_OUTSIDE_ROOT",
    );
  });
});
