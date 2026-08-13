import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";
import { reapExpiredUploads, stopUploadJanitor } from "../src/lib/upload-janitor";

/*
 * Upload lifecycle: init, resume query, abort, janitor (issue 28, PRD §9.5).
 *
 * A real temp storage root and a real SQLite file, same reasoning as
 * `tests/admin-tools.test.ts`: the free-space preflight, the temp directory
 * that has to actually exist for the resume/cancel/janitor cases to mean
 * anything, and the sanitised filename all live or die on disk, not in a mock.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-uploads-"));
  root = join(dir, "storage");
  mkdirSync(root);

  const dbUrl = `file:${join(dir, "uploads.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.UPLOAD_SUBDIR = "uploads";
  process.env.CHUNK_SIZE = "1048576"; // 1 MiB, so totalChunks is small and legible in assertions
  process.env.UPLOAD_TTL_HOURS = "24";
  resetEnvCache();
});

afterAll(() => {
  rmSync(resolve(root, ".."), { recursive: true, force: true });
});

beforeEach(async () => {
  const { prisma } = await import("../src/lib/db");
  await prisma.upload.deleteMany();
});

afterEach(() => {
  stopUploadJanitor();
});

// --- callers -------------------------------------------------------------------

async function init(payload: unknown) {
  const { POST } = await import("../src/app/api/uploads/init/route");
  const response = await POST(
    new Request("http://hub.test/api/uploads/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
  );
  return { response, body: await response.json() };
}

async function resume(id: string) {
  const { GET } = await import("../src/app/api/uploads/[id]/route");
  const response = await GET(new Request(`http://hub.test/api/uploads/${id}`), {
    params: Promise.resolve({ id }),
  });
  return { response, body: await response.json() };
}

async function cancel(id: string) {
  const { DELETE } = await import("../src/app/api/uploads/[id]/route");
  return DELETE(new Request(`http://hub.test/api/uploads/${id}`, { method: "DELETE" }), {
    params: Promise.resolve({ id }),
  });
}

const body = { fileName: "ubuntu-22.04.4-live-server-amd64.iso", totalSize: "4194304" }; // 4 MiB

// --- init ------------------------------------------------------------------

describe("POST /api/uploads/init", () => {
  it("creates the Upload row and its temp directory, and returns the protocol shape", async () => {
    const { response, body: created } = await init(body);

    expect(response.status).toBe(201);
    expect(created).toMatchObject({ chunkSize: 1_048_576, totalChunks: 4, received: [] });
    expect(typeof created.uploadId).toBe("string");

    const { prisma } = await import("../src/lib/db");
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(row.status).toBe("pending");
    expect(existsSync(row.tempDir)).toBe(true);
    expect(row.tempDir).toContain(join(".uploads", created.uploadId));
  });

  it("sanitises a path-traversal filename to its basename", async () => {
    const { body: created } = await init({ ...body, fileName: "../../evil.sh" });

    const { prisma } = await import("../src/lib/db");
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });
    expect(row.fileName).toBe("evil.sh");
  });

  it("rejects an upload larger than the free space on disk (PRD §14)", async () => {
    // No real disk has 8 petabytes free — this exercises the actual statvfs
    // call rather than a mocked one, same spirit as the traversal suite.
    const { response, body: error } = await init({ ...body, totalSize: "8000000000000000" });

    expect(response.status).toBe(507);
    expect(error.error.code).toBe("INSUFFICIENT_STORAGE");

    const { prisma } = await import("../src/lib/db");
    expect(await prisma.upload.count()).toBe(0);
  });

  it("rejects a body that fails the shared schema", async () => {
    const { response } = await init({ fileName: "", totalSize: "4194304" });
    expect(response.status).toBe(400);
  });
});

// --- resume ------------------------------------------------------------------

describe("GET /api/uploads/[id]", () => {
  it("returns the correct received set", async () => {
    const { body: created } = await init(body);

    const { prisma } = await import("../src/lib/db");
    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { received: JSON.stringify([0, 2]) },
    });

    const { response, body: resumed } = await resume(created.uploadId);

    expect(response.status).toBe(200);
    expect(resumed).toEqual({
      uploadId: created.uploadId,
      received: [0, 2],
      totalChunks: 4,
      status: "pending",
    });
  });

  it("404s for an unknown id", async () => {
    expect((await resume("nope")).response.status).toBe(404);
  });
});

// --- cancel --------------------------------------------------------------------

describe("DELETE /api/uploads/[id]", () => {
  it("removes all temp chunks and the row", async () => {
    const { body: created } = await init(body);
    const { prisma } = await import("../src/lib/db");
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });

    // Stand in for chunks issue 29's PUT handler would have written.
    writeFileSync(join(row.tempDir, "0.part"), "x".repeat(1_048_576));
    writeFileSync(join(row.tempDir, "1.part"), "y".repeat(1_048_576));

    const response = await cancel(created.uploadId);

    expect(response.status).toBe(204);
    expect(existsSync(row.tempDir)).toBe(false);
    expect(await prisma.upload.count()).toBe(0);
  });

  it("404s for an unknown id", async () => {
    expect((await cancel("nope")).status).toBe(404);
  });
});

// --- janitor -------------------------------------------------------------------

describe("upload janitor", () => {
  it("reaps an artificially expired upload, row and directory both", async () => {
    const { body: created } = await init(body);
    const { prisma } = await import("../src/lib/db");
    const row = await prisma.upload.findUniqueOrThrow({ where: { id: created.uploadId } });

    await prisma.upload.update({
      where: { id: created.uploadId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });

    const reaped = await reapExpiredUploads();

    expect(reaped).toBe(1);
    expect(existsSync(row.tempDir)).toBe(false);
    expect(await prisma.upload.count()).toBe(0);
  });

  it("leaves an unexpired upload alone", async () => {
    const { body: created } = await init(body);

    const reaped = await reapExpiredUploads();

    expect(reaped).toBe(0);
    const { prisma } = await import("../src/lib/db");
    expect(await prisma.upload.count()).toBe(1);
    expect(await prisma.upload.findUnique({ where: { id: created.uploadId } })).not.toBeNull();
  });
});
