import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

/*
 * PUT /api/uploads/[id]/chunk (issue 29, PRD §9.5, CONTEXT §7.3).
 *
 * A real temp storage root and a real SQLite file, same reasoning as
 * `tests/uploads-api.test.ts`: whether a chunk actually lands at the right
 * byte offset on disk, and whether `received` stays correct under concurrent
 * writes, are both facts about the real filesystem and the real DB, not
 * something a mock can stand in for.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-chunk-"));
  root = join(dir, "storage");
  mkdirSync(root);

  const dbUrl = `file:${join(dir, "chunk.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.UPLOAD_SUBDIR = "uploads";
  process.env.CHUNK_SIZE = "1048576"; // 1 MiB, so a handful of chunks is a realistic multi-chunk upload
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

// --- callers -----------------------------------------------------------------

async function init(totalSize: string, fileName = "ubuntu.iso") {
  const { POST } = await import("../src/app/api/uploads/init/route");
  const response = await POST(
    new Request("http://hub.test/api/uploads/init", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ fileName, totalSize }),
    }),
  );
  return response.json() as Promise<{ uploadId: string; chunkSize: number; totalChunks: number }>;
}

async function putChunk(id: string, index: number, bytes: Buffer | string) {
  const { PUT } = await import("../src/app/api/uploads/[id]/chunk/route");
  const response = await PUT(
    new Request(`http://hub.test/api/uploads/${id}/chunk?index=${index}`, {
      method: "PUT",
      // `Buffer` satisfies `BodyInit` at runtime (it is a `Uint8Array`), but
      // lib.dom.d.ts's `BodyInit` union does not spell that out.
      body: bytes as BodyInit,
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, body: await response.json() };
}

async function resume(id: string) {
  const { GET } = await import("../src/app/api/uploads/[id]/route");
  const response = await GET(new Request(`http://hub.test/api/uploads/${id}`), {
    params: Promise.resolve({ id }),
  });
  return response.json() as Promise<{ received: number[] }>;
}

async function tempDirFor(id: string): Promise<string> {
  const { prisma } = await import("../src/lib/db");
  return (await prisma.upload.findUniqueOrThrow({ where: { id } })).tempDir;
}

// --- happy path ----------------------------------------------------------------

describe("PUT /api/uploads/[id]/chunk", () => {
  it("writes the chunk to <index>.part and marks it received", async () => {
    const { uploadId } = await init("2097152"); // 2 MiB -> 2 chunks
    const payload = Buffer.from("x".repeat(1_048_576));

    const { response, body } = await putChunk(uploadId, 0, payload);

    expect(response.status).toBe(200);
    expect(body).toEqual({ received: 0, count: 1 });

    const dir = await tempDirFor(uploadId);
    expect(readFileSync(join(dir, "0.part"))).toEqual(payload);
  });

  it("lands out-of-order chunks and completes the received set", async () => {
    const { uploadId } = await init("3145728"); // 3 MiB -> 3 chunks
    const part = Buffer.from("y".repeat(1_048_576));

    await putChunk(uploadId, 2, part);
    await putChunk(uploadId, 0, part);
    const last = await putChunk(uploadId, 1, part);

    expect(last.body).toEqual({ received: 1, count: 3 });
    expect((await resume(uploadId)).received).toEqual([0, 1, 2]);
  });

  it("is idempotent for a duplicate chunk index", async () => {
    const { uploadId } = await init("2097152");
    const part = Buffer.from("z".repeat(1_048_576));

    await putChunk(uploadId, 0, part);
    const second = await putChunk(uploadId, 0, part);

    expect(second.body).toEqual({ received: 0, count: 1 }); // not 2
    expect((await resume(uploadId)).received).toEqual([0]);
  });

  it("both land when two chunks are written concurrently", async () => {
    const { uploadId } = await init("2097152");
    const part = Buffer.from("w".repeat(1_048_576));

    await Promise.all([putChunk(uploadId, 0, part), putChunk(uploadId, 1, part)]);

    expect((await resume(uploadId)).received).toEqual([0, 1]);
  });

  it("streams a multi-megabyte chunk through to disk intact", async () => {
    const { uploadId } = await init("5242880"); // 5 MiB -> 5 chunks
    const big = Buffer.alloc(5 * 1_048_576, "q");

    const { response } = await putChunk(uploadId, 0, big);

    expect(response.status).toBe(200);
    const dir = await tempDirFor(uploadId);
    const written = readFileSync(join(dir, "0.part"));
    expect(written.length).toBe(big.length);
    expect(written.equals(big)).toBe(true);
  });

  // --- refusals ------------------------------------------------------------

  it("rejects an out-of-range index", async () => {
    const { uploadId } = await init("1048576"); // 1 chunk: valid index is only 0

    expect((await putChunk(uploadId, -1, "x")).response.status).toBe(400);
    expect((await putChunk(uploadId, 1, "x")).response.status).toBe(400);
    expect((await putChunk(uploadId, 1.5, "x")).response.status).toBe(400);
  });

  it("refuses a chunk for an expired upload", async () => {
    const { uploadId } = await init("1048576");
    const { prisma } = await import("../src/lib/db");
    await prisma.upload.update({ where: { id: uploadId }, data: { expiresAt: new Date(Date.now() - 1000) } });

    const { response, body } = await putChunk(uploadId, 0, "x");
    expect([409, 410]).toContain(response.status);
    expect(body.error.code).toBe("CONFLICT");
  });

  it("refuses a chunk once the upload is no longer pending", async () => {
    const { uploadId } = await init("1048576");
    const { prisma } = await import("../src/lib/db");
    await prisma.upload.update({ where: { id: uploadId }, data: { status: "completed" } });

    const { response } = await putChunk(uploadId, 0, "x");
    expect(response.status).toBe(409);
  });

  it("404s for an unknown upload id", async () => {
    expect((await putChunk("nope", 0, "x")).response.status).toBe(404);
  });
});
