import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

/*
 * POST /api/uploads/[id]/complete (issue 30, PRD §9.5, CONTEXT §7.3).
 *
 * A real temp storage root and a real SQLite file, same reasoning as the rest
 * of the upload suite: whether the assembled file is byte-identical to what
 * was sent, and whether its SHA-256 matches what `sha256sum` would say, are
 * facts about real bytes on a real disk.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-complete-"));
  root = join(dir, "storage");
  mkdirSync(root);

  const dbUrl = `file:${join(dir, "complete.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.UPLOAD_SUBDIR = "uploads";
  process.env.CHUNK_SIZE = "1048576"; // 1 MiB
  process.env.UPLOAD_TTL_HOURS = "24";
  resetEnvCache();
});

afterAll(() => {
  rmSync(resolve(root, ".."), { recursive: true, force: true });
});

beforeEach(async () => {
  const { prisma } = await import("../src/lib/db");
  await prisma.upload.deleteMany();
  await prisma.auditLog.deleteMany();
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
  return response.json() as Promise<{ uploadId: string; totalChunks: number }>;
}

async function putChunk(id: string, index: number, bytes: Buffer) {
  const { PUT } = await import("../src/app/api/uploads/[id]/chunk/route");
  const response = await PUT(
    new Request(`http://hub.test/api/uploads/${id}/chunk?index=${index}`, {
      method: "PUT",
      body: bytes as unknown as BodyInit,
    }),
    { params: Promise.resolve({ id }) },
  );
  if (response.status !== 200) throw new Error(`chunk ${index} failed: ${response.status}`);
}

async function complete(id: string, payload: unknown = {}) {
  const { POST } = await import("../src/app/api/uploads/[id]/complete/route");
  const response = await POST(
    new Request(`http://hub.test/api/uploads/${id}/complete`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, body: await response.json() };
}

async function uploadRow(id: string) {
  const { prisma } = await import("../src/lib/db");
  return prisma.upload.findUniqueOrThrow({ where: { id } });
}

/** Deterministic, non-uniform content — a repeated chunk pattern would hide a byte-order bug. */
function content(byteLength: number, seed: number): Buffer {
  const buf = Buffer.alloc(byteLength);
  for (let i = 0; i < byteLength; i++) buf[i] = (seed + i) % 256;
  return buf;
}

// --- happy path ----------------------------------------------------------------

describe("POST /api/uploads/[id]/complete", () => {
  it("assembles a short-final-chunk upload byte-identical, with a matching SHA-256", async () => {
    const totalSize = 2 * 1_048_576 + 777; // 2 full chunks + one short final chunk
    const { uploadId, totalChunks } = await init(String(totalSize));
    expect(totalChunks).toBe(3);

    const parts = [content(1_048_576, 0), content(1_048_576, 1), content(777, 2)];
    for (let i = 0; i < parts.length; i++) await putChunk(uploadId, i, parts[i]!);

    const { response, body } = await complete(uploadId);

    expect(response.status).toBe(200);
    expect(body.fileName).toBe("ubuntu.iso");
    expect(body.fileSize).toBe(String(totalSize));
    expect(body.filePath).toBe("uploads/ubuntu.iso");

    const assembled = readFileSync(join(root, "uploads", "ubuntu.iso"));
    expect(assembled.equals(Buffer.concat(parts))).toBe(true);

    const expectedHash = createHash("sha256").update(Buffer.concat(parts)).digest("hex");
    expect(body.checksum).toBe(expectedHash);

    const row = await uploadRow(uploadId);
    expect(row.status).toBe("completed");
    expect(row.finalPath).toBe("uploads/ubuntu.iso");
    expect(existsSync(row.tempDir)).toBe(false);
  });

  it("writes an upload.complete AuditLog row", async () => {
    const { uploadId } = await init("1048576", "audited.iso");
    await putChunk(uploadId, 0, content(1_048_576, 0));

    await complete(uploadId);

    const { prisma } = await import("../src/lib/db");
    const rows = await prisma.auditLog.findMany({ where: { action: "upload.complete" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.targetId).toBe(uploadId);
    expect(JSON.parse(rows[0]!.detail!)).toMatchObject({ fileName: "audited.iso", path: "uploads/audited.iso" });
  });

  it("resolves into a targetSubdir when one is given", async () => {
    const { uploadId } = await init("1048576", "driver.zip");
    await putChunk(uploadId, 0, content(1_048_576, 0));

    const { body } = await complete(uploadId, { targetSubdir: "drivers/network" });

    expect(body.filePath).toBe("uploads/drivers/network/driver.zip");
    expect(existsSync(join(root, "uploads", "drivers", "network", "driver.zip"))).toBe(true);
  });

  // --- collisions ------------------------------------------------------------

  it("suffixes a name collision with \" (2)\" rather than overwriting", async () => {
    mkdirSync(join(root, "uploads"), { recursive: true });
    const original = content(1_048_576, 9);
    writeFileSync(join(root, "uploads", "dup.iso"), original);

    const { uploadId } = await init("1048576", "dup.iso");
    await putChunk(uploadId, 0, content(1_048_576, 1));

    const { body } = await complete(uploadId);

    expect(body.fileName).toBe("dup (2).iso");
    expect(body.filePath).toBe("uploads/dup (2).iso");
    // The original is untouched.
    expect(readFileSync(join(root, "uploads", "dup.iso")).equals(original)).toBe(true);
  });

  it("replaces the existing file when overwrite is true", async () => {
    mkdirSync(join(root, "uploads"), { recursive: true });
    writeFileSync(join(root, "uploads", "dup2.iso"), content(1_048_576, 9));

    const { uploadId } = await init("1048576", "dup2.iso");
    const fresh = content(1_048_576, 1);
    await putChunk(uploadId, 0, fresh);

    const { body } = await complete(uploadId, { overwrite: true });

    expect(body.fileName).toBe("dup2.iso");
    expect(readFileSync(join(root, "uploads", "dup2.iso")).equals(fresh)).toBe(true);
  });

  // --- refusals ----------------------------------------------------------------

  it("refuses to complete with a missing chunk (409), leaving the temp dir intact", async () => {
    const { uploadId } = await init("3145728"); // 3 chunks
    await putChunk(uploadId, 0, content(1_048_576, 0));
    // Chunk 1 never arrives.
    await putChunk(uploadId, 2, content(1_048_576, 2));

    const row = await uploadRow(uploadId);
    const { response, body } = await complete(uploadId);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("CONFLICT");
    expect(existsSync(row.tempDir)).toBe(true);
    expect((await uploadRow(uploadId)).status).toBe("pending");
  });

  it("refuses a chunk whose size does not match what its index implies (409)", async () => {
    const { uploadId } = await init("2097152"); // 2 full 1 MiB chunks expected
    await putChunk(uploadId, 0, content(1_048_576, 0));
    await putChunk(uploadId, 1, content(1_048_576 - 100, 1)); // short, not the last index

    const row = await uploadRow(uploadId);
    const { response, body } = await complete(uploadId);

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("SIZE_MISMATCH");
    expect(existsSync(row.tempDir)).toBe(true);
  });

  it("404s for an unknown upload id", async () => {
    expect((await complete("nope")).response.status).toBe(404);
  });

  it("refuses to complete an upload that already completed", async () => {
    const { uploadId } = await init("1048576");
    await putChunk(uploadId, 0, content(1_048_576, 0));
    await complete(uploadId);

    const { response } = await complete(uploadId);
    expect(response.status).toBe(409);
  });
});
