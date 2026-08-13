import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, sep } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import { resetRateLimits } from "../src/lib/rate-limit";

/*
 * GET /api/browse at the HTTP layer (issue 26, PRD §9.3, §11.1).
 *
 * `tests/storage.test.ts` proves the traversal rules against `listDirectory`
 * directly and gates P3 as `pnpm test:security`; this file re-runs the same
 * attack table *through the route*, because issue 26's "done when" is explicit
 * that the library being safe is not the same claim as the endpoint being safe
 * — a handler could still misparse the query or swallow the error code on the
 * way out.
 */

let base: string;
let root: string;
let evilSibling: string;

beforeAll(async () => {
  base = mkdtempSync(join(tmpdir(), "labsy-browse-"));

  root = join(base, "downloads");
  mkdirSync(root);

  evilSibling = `${root}-evil`;
  mkdirSync(evilSibling);
  writeFileSync(join(evilSibling, "secrets.txt"), "should never be reachable");

  mkdirSync(join(root, "isos"));
  writeFileSync(join(root, "isos", "ubuntu-22.04.4-live-server-amd64.iso"), "x".repeat(2048));
  writeFileSync(join(root, "labsy-deployer.zip"), "x".repeat(512));
  writeFileSync(join(root, ".hidden-notes"), "x");

  mkdirSync(join(root, ".uploads"));
  writeFileSync(join(root, ".uploads", "0.part"), "x");

  symlinkSync(evilSibling, join(root, "escape-link"));

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = "file:./test.db";
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.AUTH_SECRET = "x".repeat(32);
  resetEnvCache();
});

afterAll(() => {
  rmSync(base, { recursive: true, force: true });
});

beforeEach(() => {
  resetRateLimits();
});

async function browse(query: string, headers: Record<string, string> = { cookie: "labsy_session=t1" }) {
  const { GET } = await import("../src/app/api/browse/route");
  const response = await GET(new Request(`http://hub.test/api/browse${query}`, { headers }));
  return { response, body: await response.json() };
}

describe("PRD §11.1 attack table, through the route", () => {
  it("rejects a relative escape", async () => {
    const { response, body } = await browse("?path=../../etc/passwd");
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a relative escape that would land on a real file", async () => {
    const { response, body } = await browse(`?path=${encodeURIComponent("../downloads-evil/secrets.txt")}`);
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a double-encoded escape without decoding it a second time", async () => {
    const { response, body } = await browse("?path=%252e%252e%252f");
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects an absolute path, neutralising it rather than reading it", async () => {
    const { response, body } = await browse(`?path=${encodeURIComponent("/etc/hosts")}`);
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects a null byte", async () => {
    const { response, body } = await browse(`?path=${encodeURIComponent("foo\0.iso")}`);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("INVALID_PATH");
  });

  it("rejects a symlink escaping the root", async () => {
    const { response, body } = await browse("?path=escape-link");
    expect(response.status).toBe(403);
    expect(body.error.code).toBe("PATH_OUTSIDE_ROOT");
  });

  it("rejects prefix confusion — the sibling directory sharing the root's prefix", async () => {
    const { response, body } = await browse(`?path=${encodeURIComponent(`..${sep}downloads-evil`)}`);
    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("rejects an overlong path", async () => {
    // Caught by `browseQuerySchema`'s own max(4096) before it ever reaches
    // `listDirectory` — still a 400, just the schema's code rather than
    // `lib/storage.ts`'s internal `INVALID_PATH` check on the same limit.
    const { response, body } = await browse(`?path=${"a".repeat(5000)}`);
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("refuses to list a file", async () => {
    const { response, body } = await browse("?path=labsy-deployer.zip");
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("NOT_A_DIRECTORY");
  });
});

describe("response shape (PRD §9.3)", () => {
  it("lists the root with directories before files, each alphabetical", async () => {
    const { response, body } = await browse("");

    expect(response.status).toBe(200);
    expect(body.path).toBe("");
    expect(body.parent).toBeNull();
    expect(body.entries.map((e: { name: string }) => e.name)).toEqual([
      "isos",
      "labsy-deployer.zip",
    ]);
  });

  it("never lists the internal .uploads directory, even with hidden files shown", async () => {
    const { body } = await browse("?showHidden=true");
    expect(body.entries.map((e: { name: string }) => e.name)).not.toContain(".uploads");
  });

  it("hides dotfiles by default and reveals them with showHidden=true", async () => {
    const withoutHidden = await browse("");
    expect(withoutHidden.body.entries.map((e: { name: string }) => e.name)).not.toContain(".hidden-notes");

    const withHidden = await browse("?showHidden=true");
    expect(withHidden.body.entries.map((e: { name: string }) => e.name)).toContain(".hidden-notes");
  });

  it("sends file size as a string and mtime as an ISO string", async () => {
    const { body } = await browse("?path=isos");
    const iso = body.entries.find(
      (e: { name: string }) => e.name === "ubuntu-22.04.4-live-server-amd64.iso",
    );
    expect(iso.size).toBe("2048");
    expect(() => new Date(iso.mtime).toISOString()).not.toThrow();
  });

  it("sets parent to null at the root and to the parent path elsewhere", async () => {
    expect((await browse("")).body.parent).toBeNull();
    expect((await browse("?path=isos")).body.parent).toBe("");
  });
});

describe("permission errors", () => {
  it("names the relative directory, not the host path, and does not crash", async () => {
    const locked = join(root, "locked");
    mkdirSync(locked, { recursive: true });
    chmodSync(locked, 0o000);

    try {
      const { response, body } = await browse("?path=locked");
      expect(response.status).toBe(403);
      expect(body.error.code).toBe("EACCES");
      expect(body.error.message).toMatch(/locked/);
      expect(body.error.message).not.toContain(root);
    } finally {
      chmodSync(locked, 0o700);
      rmSync(locked, { recursive: true, force: true });
    }
  });
});

describe("rate limiting (PRD §11.2: 60/min, keyed by session)", () => {
  it("allows 60 requests then 429s the 61st, for one session", async () => {
    for (let i = 0; i < 60; i++) {
      expect((await browse("", { cookie: "labsy_session=heavy-user" })).response.status).toBe(200);
    }

    const { response, body } = await browse("", { cookie: "labsy_session=heavy-user" });
    expect(response.status).toBe(429);
    expect(body.error.code).toBe("RATE_LIMITED");
    expect(response.headers.get("Retry-After")).not.toBeNull();
  });

  it("keys the limit by session, so one admin's traffic cannot exhaust another's", async () => {
    for (let i = 0; i < 60; i++) {
      await browse("", { cookie: "labsy_session=session-a" });
    }
    expect((await browse("", { cookie: "labsy_session=session-a" })).response.status).toBe(429);

    // A different session cookie gets a fresh bucket.
    expect((await browse("", { cookie: "labsy_session=session-b" })).response.status).toBe(200);
  });
});
