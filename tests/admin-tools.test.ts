import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

/*
 * The write path (issue 22). Against a real temp storage root and a real
 * SQLite file, because every rule worth testing here is about what is actually
 * on disk: a path that escapes the root, a directory posing as a file, a
 * symlink, a size that must come from `stat` rather than from the request.
 *
 * The session is not exercised — `src/proxy.ts` owns that and `tests/proxy.test.ts`
 * proves it. These handlers are written on the assumption the guard already ran.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;
/** The root as the app sees it — `/var` is a symlink to `/private/var` on macOS. */
let realRoot: string;
let outside: string;

const body = {
  name: "Ubuntu 22.04.4 LTS Server",
  description: "Minimal server image with cloud-init and the standard Labsy provisioning overlay.",
  category: "  os   IMAGES ",
  version: "22.04.4",
};

beforeAll(() => {
  const dir = mkdtempSync(join(tmpdir(), "labsy-admin-"));
  root = join(dir, "storage");
  outside = join(dir, "elsewhere");
  mkdirSync(root);
  mkdirSync(outside);
  realRoot = realpathSync(root);

  writeFileSync(join(outside, "secret.txt"), "not yours");

  const dbUrl = `file:${join(dir, "admin.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.UPLOAD_SUBDIR = "uploads";
  resetEnvCache();
});

afterAll(() => {
  rmSync(resolve(root, ".."), { recursive: true, force: true });
});

/*
 * The fixtures are rebuilt per test, not per file. Several tests here delete
 * files on purpose — that is the feature — and a shared fixture tree turns the
 * first successful deletion into a cascade of unrelated failures further down
 * the file, which is exactly what happened while writing this.
 */
beforeEach(async () => {
  rmSync(root, { recursive: true, force: true });
  mkdirSync(join(root, "images"), { recursive: true });

  writeFileSync(join(root, "images", "ubuntu.iso"), "x".repeat(2048));
  writeFileSync(join(root, "images", "windows.iso"), "y".repeat(1024));
  writeFileSync(join(root, "deployer.msi"), "z".repeat(512));
  symlinkSync(join(root, "images", "ubuntu.iso"), join(root, "linked.iso"));

  const { prisma } = await import("../src/lib/db");
  await prisma.tool.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.upload.deleteMany();
});

// --- callers -----------------------------------------------------------------

const IP = { "x-forwarded-for": "10.20.30.40" };

async function post(payload: unknown) {
  const { POST } = await import("../src/app/api/admin/tools/route");
  const response = await POST(
    new Request("http://hub.test/api/admin/tools", {
      method: "POST",
      headers: { "content-type": "application/json", ...IP },
      body: JSON.stringify(payload),
    }),
  );
  return { response, body: await response.json() };
}

async function listAdmin(query = "") {
  const { GET } = await import("../src/app/api/admin/tools/route");
  const response = await GET(new Request(`http://hub.test/api/admin/tools${query}`));
  return { response, body: await response.json() };
}

async function send(method: "PUT" | "PATCH", id: string, payload: unknown) {
  const route = await import("../src/app/api/admin/tools/[id]/route");
  const response = await route[method](
    new Request("http://hub.test/api/admin/tools/x", {
      method,
      headers: { "content-type": "application/json", ...IP },
      body: JSON.stringify(payload),
    }),
    { params: Promise.resolve({ id }) },
  );
  return { response, body: await response.json() };
}

async function remove(id: string, query = "") {
  const { DELETE } = await import("../src/app/api/admin/tools/[id]/route");
  const response = await DELETE(
    new Request(`http://hub.test/api/admin/tools/x${query}`, { method: "DELETE", headers: IP }),
    { params: Promise.resolve({ id }) },
  );
  return { response, body: await response.json() };
}

async function eligibility(id: string) {
  const { GET } = await import("../src/app/api/admin/tools/[id]/delete-eligibility/route");
  const response = await GET(new Request("http://hub.test/api/admin/tools/x/delete-eligibility"), {
    params: Promise.resolve({ id }),
  });
  return { response, body: await response.json() };
}

const serverPath = (relativePath: string) => ({ source: "serverPath", relativePath });

async function auditRows() {
  const { prisma } = await import("../src/lib/db");
  return prisma.auditLog.findMany({ orderBy: { createdAt: "asc" } });
}

// --- create ------------------------------------------------------------------

describe("POST /api/admin/tools", () => {
  it("registers a file and snapshots its facts from the stat", async () => {
    const { response, body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    expect(response.status).toBe(201);
    expect(created).toMatchObject({
      slug: "ubuntu-22-04-4-lts-server",
      fileName: "ubuntu.iso",
      fileSize: "2048",
      mimeType: "application/x-iso9660-image",
      published: true,
      visibility: "public",
      fileMissing: false,
    });
  });

  it("sends back a relative path, never the host path (CONTEXT §2 item 5)", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    expect(created.filePath).toBe("images/ubuntu.iso");
    expect(JSON.stringify(created)).not.toContain(realRoot);
  });

  it("stores the absolute path in the database, because the client never sees it", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    const { prisma } = await import("../src/lib/db");
    const row = await prisma.tool.findUniqueOrThrow({ where: { id: created.id } });
    expect(row.filePath).toBe(join(realRoot, "images", "ubuntu.iso"));
  });

  it("title-cases and collapses the category (PRD §8.3)", async () => {
    const { body: created } = await post({ ...body, file: serverPath("deployer.msi") });
    expect(created.category).toBe("Os Images");
  });

  it("refuses a path outside the storage root", async () => {
    const { response, body: error } = await post({
      ...body,
      file: serverPath("../elsewhere/secret.txt"),
    });

    // `..` is neutralised before resolution, so this lands inside the root and
    // simply is not there — the escape never becomes a real path to reject.
    expect(response.status).toBe(404);
    expect(error.error.code).toBe("NOT_FOUND");
  });

  it("refuses an absolute path to somewhere else on the host", async () => {
    const { response } = await post({ ...body, file: serverPath(join(outside, "secret.txt")) });
    expect([403, 404]).toContain(response.status);
  });

  it("refuses a directory", async () => {
    const { response, body: error } = await post({ ...body, file: serverPath("images") });

    expect(response.status).toBe(400);
    expect(error.error.message).toMatch(/not a regular file/i);
  });

  it("refuses a file that is not there", async () => {
    const { response } = await post({ ...body, file: serverPath("images/nope.iso") });
    expect(response.status).toBe(404);
  });

  it("rejects a body that fails the shared schema", async () => {
    const { response, body: error } = await post({ ...body, name: "x", file: serverPath("deployer.msi") });

    expect(response.status).toBe(400);
    expect(error.error.code).toBe("VALIDATION_FAILED");
  });

  it("rejects a create with no file source at all", async () => {
    expect((await post(body)).response.status).toBe(400);
  });
});

describe("slug collisions", () => {
  it("suffixes a derived slug rather than failing", async () => {
    const first = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const second = await post({ ...body, file: serverPath("images/windows.iso") });
    const third = await post({ ...body, file: serverPath("deployer.msi") });

    expect(first.body.slug).toBe("ubuntu-22-04-4-lts-server");
    expect(second.body.slug).toBe("ubuntu-22-04-4-lts-server-2");
    expect(third.body.slug).toBe("ubuntu-22-04-4-lts-server-3");
  });

  it("refuses a slug the admin typed, because that was a decision", async () => {
    await post({ ...body, slug: "ubuntu-server", file: serverPath("images/ubuntu.iso") });
    const { response, body: error } = await post({
      ...body,
      slug: "ubuntu-server",
      file: serverPath("images/windows.iso"),
    });

    expect(response.status).toBe(409);
    expect(error.error.code).toBe("SLUG_TAKEN");
  });
});

// --- read --------------------------------------------------------------------

describe("GET /api/admin/tools", () => {
  it("includes drafts, internal tools, and rows whose file is missing", async () => {
    const { prisma } = await import("../src/lib/db");
    await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const draft = await post({ ...body, published: false, file: serverPath("images/windows.iso") });
    const internal = await post({ ...body, visibility: "admin", file: serverPath("deployer.msi") });
    await prisma.tool.update({ where: { id: draft.body.id }, data: { fileMissing: true } });

    const { body: listed } = await listAdmin();

    expect(listed.total).toBe(3);
    expect(listed.tools.map((t: { id: string }) => t.id)).toContain(internal.body.id);
    expect(listed.tools.find((t: { id: string }) => t.id === draft.body.id).fileMissing).toBe(true);

    // The public list's scoping is tests/tools-api.test.ts's job — reaching for
    // it here would need Next's request scope for `cookies()`.
  });

  it("carries relative paths on every row", async () => {
    await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const { body: listed } = await listAdmin();

    expect(listed.tools[0].filePath).toBe("images/ubuntu.iso");
  });
});

describe("GET /api/admin/categories", () => {
  it("counts categories across drafts and internal tools", async () => {
    await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await post({ ...body, category: "Utilities", visibility: "admin", file: serverPath("deployer.msi") });

    const { GET } = await import("../src/app/api/admin/categories/route");
    const listed = await (await GET()).json();

    expect(listed.categories).toEqual([
      { name: "Os Images", count: 1 },
      { name: "Utilities", count: 1 },
    ]);
  });
});

// --- update ------------------------------------------------------------------

describe("PUT and PATCH", () => {
  it("PATCH flips one field and leaves the rest alone", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const { response, body: updated } = await send("PATCH", created.id, { published: false });

    expect(response.status).toBe(200);
    expect(updated.published).toBe(false);
    expect(updated.name).toBe(created.name);
    expect(updated.fileSize).toBe("2048");
  });

  it("PUT demands the core fields, so a partial body is a 400", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    expect((await send("PUT", created.id, { published: false })).response.status).toBe(400);
  });

  it("PUT without a file source keeps the current bytes", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const { body: updated } = await send("PUT", created.id, { ...body, name: "Renamed Server Image" });

    expect(updated.name).toBe("Renamed Server Image");
    expect(updated.filePath).toBe("images/ubuntu.iso");
    expect(updated.fileSize).toBe("2048");
  });

  it("re-stats when the path changes, rather than carrying a stale size", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const { body: updated } = await send("PATCH", created.id, {
      file: serverPath("images/windows.iso"),
    });

    expect(updated.filePath).toBe("images/windows.iso");
    expect(updated.fileSize).toBe("1024");
    expect(updated.fileName).toBe("windows.iso");
  });

  it("clears fileMissing when a stat succeeds again", async () => {
    const { prisma } = await import("../src/lib/db");
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await prisma.tool.update({ where: { id: created.id }, data: { fileMissing: true } });

    const { body: updated } = await send("PATCH", created.id, {
      file: serverPath("images/ubuntu.iso"),
    });
    expect(updated.fileMissing).toBe(false);
  });

  it("keeps the slug stable when only the name changes", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const { body: updated } = await send("PATCH", created.id, { name: "Something Else Entirely" });

    expect(updated.slug).toBe(created.slug);
  });

  it("refuses a slug already taken by another tool", async () => {
    await post({ ...body, slug: "taken", file: serverPath("images/ubuntu.iso") });
    const { body: other } = await post({ ...body, file: serverPath("images/windows.iso") });

    const { response } = await send("PATCH", other.id, { slug: "taken" });
    expect(response.status).toBe(409);
  });

  it("accepts a tool's own slug unchanged", async () => {
    const { body: created } = await post({ ...body, slug: "keeper", file: serverPath("images/ubuntu.iso") });
    expect((await send("PATCH", created.id, { slug: "keeper" })).response.status).toBe(200);
  });

  it("404s for an unknown id", async () => {
    expect((await send("PATCH", "nope", { published: false })).response.status).toBe(404);
  });

  it("finds a tool by slug as well as by id", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    expect((await send("PATCH", created.slug, { featured: true })).body.featured).toBe(true);
  });
});

// --- delete ------------------------------------------------------------------

describe("DELETE", () => {
  it("removes the catalogue entry and keeps the file by default (PRD §16 D4)", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    const { response, body: outcome } = await remove(created.id);

    expect(response.status).toBe(200);
    expect(outcome).toEqual({ deleted: true, fileDeleted: false });
    expect(existsSync(join(root, "images", "ubuntu.iso"))).toBe(true);
  });

  it("deletes the file only when explicitly asked", async () => {
    writeFileSync(join(root, "throwaway.bin"), "bytes");
    const { body: created } = await post({ ...body, file: serverPath("throwaway.bin") });

    const { body: outcome } = await remove(created.id, "?deleteFile=true");

    expect(outcome).toEqual({ deleted: true, fileDeleted: true });
    expect(existsSync(join(root, "throwaway.bin"))).toBe(false);
  });

  it("treats anything other than the exact string true as catalogue-only", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    const { body: outcome } = await remove(created.id, "?deleteFile=1");

    expect(outcome.fileDeleted).toBe(false);
    expect(existsSync(join(root, "images", "ubuntu.iso"))).toBe(true);
  });

  it("refuses to delete a file another tool also registers", async () => {
    const first = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await post({ ...body, file: serverPath("images/ubuntu.iso") });

    const { response, body: error } = await remove(first.body.id, "?deleteFile=true");

    expect(response.status).toBe(409);
    expect(error.error.code).toBe("CONFLICT");
    // Nothing happened: the file is there and so is the catalogue entry.
    expect(existsSync(join(root, "images", "ubuntu.iso"))).toBe(true);
    const { prisma } = await import("../src/lib/db");
    expect(await prisma.tool.count()).toBe(2);
  });

  it("resolves a symlink at registration, so the row names the real artifact", async () => {
    const { body: created } = await post({ ...body, file: serverPath("linked.iso") });

    // Registration goes through `resolveWithinRoot`, which realpaths. The link
    // was how the admin addressed the file, not what was registered — so the
    // stored path is the target, and deleting this tool deletes the artifact.
    expect(created.filePath).toBe("images/ubuntu.iso");
  });

  it("refuses to delete a symlink when a row does point at one", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/windows.iso") });

    /*
     * Written straight into the row, because the create path can no longer
     * produce this state — which is the point. The guard exists for rows that
     * stopped describing what they described: hand-edited, restored from an old
     * backup, or a file swapped for a link on disk after registration.
     */
    const { prisma } = await import("../src/lib/db");
    await prisma.tool.update({
      where: { id: created.id },
      data: { filePath: join(realRoot, "linked.iso") },
    });

    const { response, body: error } = await remove(created.id, "?deleteFile=true");

    expect(response.status).toBe(400);
    expect(error.error.message).toMatch(/symlink/i);
    // The link and — the point — its target both survive.
    expect(existsSync(join(root, "linked.iso"))).toBe(true);
    expect(existsSync(join(root, "images", "ubuntu.iso"))).toBe(true);
  });

  it("404s for an unknown id", async () => {
    expect((await remove("nope")).response.status).toBe(404);
  });
});

// --- delete eligibility (issue 25) --------------------------------------------

describe("GET /api/admin/tools/[id]/delete-eligibility", () => {
  it("is eligible for a plain, unshared file", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    const { response, body: result } = await eligibility(created.id);

    expect(response.status).toBe(200);
    expect(result).toEqual({ eligible: true, reason: null });
  });

  it("agrees with DELETE: neither of two tools sharing a path offers file deletion", async () => {
    const first = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    const second = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    expect((await eligibility(first.body.id)).body.eligible).toBe(false);
    expect((await eligibility(second.body.id)).body.eligible).toBe(false);
    expect((await eligibility(first.body.id)).body.reason).toMatch(/also registered by 1 other tool/i);

    // Same refusal DELETE?deleteFile=true would give, from the same check.
    const { response: deleteResponse } = await remove(first.body.id, "?deleteFile=true");
    expect(deleteResponse.status).toBe(409);
  });

  it("agrees with DELETE: refuses a stored path that is a symlink", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/windows.iso") });

    const { prisma } = await import("../src/lib/db");
    await prisma.tool.update({
      where: { id: created.id },
      data: { filePath: join(realRoot, "linked.iso") },
    });

    const { body: result } = await eligibility(created.id);

    expect(result.eligible).toBe(false);
    expect(result.reason).toMatch(/symlink/i);
  });

  it("is ineligible when the file is missing from disk", async () => {
    writeFileSync(join(root, "vanishing.bin"), "bytes");
    const { body: created } = await post({ ...body, file: serverPath("vanishing.bin") });
    rmSync(join(root, "vanishing.bin"));

    const { body: result } = await eligibility(created.id);
    expect(result.eligible).toBe(false);
  });

  it("does not unlink the file — it only previews the decision", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });

    await eligibility(created.id);

    expect(existsSync(join(root, "images", "ubuntu.iso"))).toBe(true);
  });

  it("404s for an unknown id", async () => {
    expect((await eligibility("nope")).response.status).toBe(404);
  });

  it("finds a tool by slug as well as by id", async () => {
    await post({ ...body, slug: "findable", file: serverPath("images/ubuntu.iso") });
    expect((await eligibility("findable")).body.eligible).toBe(true);
  });
});

// --- audit -------------------------------------------------------------------

describe("AuditLog (PRD §6, §11.2)", () => {
  it("writes exactly one row per mutation, with the actor's IP", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await send("PATCH", created.id, { published: false });
    await remove(created.id);

    const rows = await auditRows();
    expect(rows.map((r) => r.action)).toEqual(["tool.create", "tool.update", "tool.delete"]);
    expect(rows.every((r) => r.actorIp === "10.20.30.40")).toBe(true);
    expect(rows.every((r) => r.targetId === created.id)).toBe(true);
  });

  it("writes no row when a mutation is refused", async () => {
    await post({ ...body, file: serverPath("images/nope.iso") });
    await send("PATCH", "unknown-id", { published: false });

    await expect(auditRows()).resolves.toHaveLength(0);
  });

  it("names the changed fields, so an update is legible later", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await send("PATCH", created.id, { published: false, version: "24.04.1" });

    const update = (await auditRows()).find((r) => r.action === "tool.update")!;
    expect(JSON.parse(update.detail!).changed.sort()).toEqual(["published", "version"]);
  });

  it("records paths relative to the root, never the host path", async () => {
    const { body: created } = await post({ ...body, file: serverPath("images/ubuntu.iso") });
    await remove(created.id, "?deleteFile=true");

    for (const row of await auditRows()) {
      expect(row.detail ?? "").not.toContain(realRoot);
    }
    const deletion = (await auditRows()).find((r) => r.action === "tool.delete")!;
    expect(JSON.parse(deletion.detail!)).toMatchObject({
      path: "images/ubuntu.iso",
      fileDeleted: true,
    });
  });
});

// --- upload source -----------------------------------------------------------

describe("file source: upload", () => {
  it("resolves a completed upload to its file under UPLOAD_SUBDIR", async () => {
    mkdirSync(join(root, "uploads"), { recursive: true });
    writeFileSync(join(root, "uploads", "assembled.iso"), "0".repeat(4096));

    const { prisma } = await import("../src/lib/db");
    const upload = await prisma.upload.create({
      data: {
        fileName: "assembled.iso",
        totalSize: 4096n,
        chunkSize: 1024,
        totalChunks: 4,
        tempDir: join(root, ".uploads", "x"),
        status: "completed",
        finalPath: "uploads/assembled.iso",
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const { response, body: created } = await post({
      ...body,
      file: { source: "upload", uploadId: upload.id },
    });

    expect(response.status).toBe(201);
    expect(created).toMatchObject({ fileName: "assembled.iso", fileSize: "4096" });
  });

  it("refuses an upload that has not finished", async () => {
    const { prisma } = await import("../src/lib/db");
    const upload = await prisma.upload.create({
      data: {
        fileName: "half.iso",
        totalSize: 4096n,
        chunkSize: 1024,
        totalChunks: 4,
        tempDir: join(root, ".uploads", "y"),
        expiresAt: new Date(Date.now() + 3_600_000),
      },
    });

    const { response } = await post({ ...body, file: { source: "upload", uploadId: upload.id } });
    expect(response.status).toBe(404);
  });

  it("refuses an upload id that does not exist", async () => {
    const { response } = await post({ ...body, file: { source: "upload", uploadId: "nope" } });
    expect(response.status).toBe(404);
  });
});
