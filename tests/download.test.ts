import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

const repoRoot = resolve(import.meta.dirname, "..");
let root: string;
let adminMode = false;

vi.mock("../src/lib/auth", () => ({ isAdmin: () => Promise.resolve(adminMode) }));

/** 2 KiB of deterministic bytes, so range slices can be checked exactly. */
const CONTENT = Buffer.from(
  Array.from({ length: 2048 }, (_, i) => String.fromCharCode(97 + (i % 26))).join(""),
);

beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "labsy-download-"));
  mkdirSync(join(root, "isos"));
  writeFileSync(join(root, "isos", "ubuntu.iso"), CONTENT);
  writeFileSync(join(root, "isos", "gone.iso"), "temporary");
  writeFileSync(join(root, "isos", "empty.iso"), "");

  const dbUrl = `file:${join(root, "download.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = root;
  process.env.DATABASE_URL = dbUrl;
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  process.env.AUTH_SECRET = "x".repeat(32);
  process.env.USE_X_ACCEL = "false";
  resetEnvCache();

  const { prisma } = await import("../src/lib/db");
  const base = {
    description: "Minimal server image with cloud-init.",
    category: "OS Images",
    version: "22.04.4",
    fileSize: BigInt(CONTENT.length),
    mimeType: "application/x-iso9660-image",
  };
  await prisma.tool.createMany({
    data: [
      { ...base, slug: "public-iso", name: "Public ISO", filePath: join(root, "isos/ubuntu.iso"), fileName: "Windows 11 Dev Kit (23H2).iso" },
      { ...base, slug: "draft-iso", name: "Draft ISO", filePath: join(root, "isos/ubuntu.iso"), fileName: "draft.iso", published: false },
      { ...base, slug: "internal-iso", name: "Internal ISO", filePath: join(root, "isos/ubuntu.iso"), fileName: "internal.iso", visibility: "admin" },
      { ...base, slug: "vanishing-iso", name: "Vanishing ISO", filePath: join(root, "isos/gone.iso"), fileName: "gone.iso" },
      { ...base, slug: "empty-iso", name: "Empty ISO", filePath: join(root, "isos/empty.iso"), fileName: "empty.iso", fileSize: 0n },
      { ...base, slug: "escaped-iso", name: "Escaped ISO", filePath: "/etc/hosts", fileName: "hosts" },
    ],
  });
});

afterAll(() => {
  adminMode = false;
  rmSync(root, { recursive: true, force: true });
});

async function download(slug: string, init?: RequestInit) {
  const { GET } = await import("../src/app/api/download/[id]/route");
  return GET(new Request(`http://lan.test/api/download/${slug}`, init), {
    params: Promise.resolve({ id: slug }),
  });
}

async function head(slug: string) {
  const { HEAD } = await import("../src/app/api/download/[id]/route");
  return HEAD(new Request(`http://lan.test/api/download/${slug}`, { method: "HEAD" }), {
    params: Promise.resolve({ id: slug }),
  });
}

describe("visibility", () => {
  it("serves a published public tool", async () => {
    const response = await download("public-iso");
    expect(response.status).toBe(200);
    expect(Buffer.from(await response.arrayBuffer()).equals(CONTENT)).toBe(true);
  });

  it("returns 404 — not 403 — for a draft", async () => {
    adminMode = false;
    expect((await download("draft-iso")).status).toBe(404);
  });

  it("returns 404 — not 403 — for an internal tool", async () => {
    adminMode = false;
    expect((await download("internal-iso")).status).toBe(404);
  });

  it("serves an internal tool to an admin", async () => {
    adminMode = true;
    expect((await download("internal-iso")).status).toBe(200);
    adminMode = false;
  });
});

describe("headers", () => {
  it("carries the PRD §9.4 header set", async () => {
    const response = await download("public-iso");

    expect(response.headers.get("Content-Type")).toBe("application/x-iso9660-image");
    expect(response.headers.get("Content-Length")).toBe(String(CONTENT.length));
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Cache-Control")).toBe("private, max-age=0, must-revalidate");
    expect(response.headers.get("ETag")).toMatch(/^"2048-\d+"$/);
    expect(response.headers.get("Last-Modified")).toBeTruthy();
  });

  it("sends both Content-Disposition forms for a name with spaces and parentheses", async () => {
    const disposition = (await download("public-iso")).headers.get("Content-Disposition");

    expect(disposition).toContain(`filename="Windows 11 Dev Kit (23H2).iso"`);
    expect(disposition).toContain("filename*=UTF-8''Windows%2011%20Dev%20Kit%20%2823H2%29.iso");
  });

  it("HEAD returns identical headers and no body", async () => {
    const [get, headResponse] = [await download("public-iso"), await head("public-iso")];

    expect(headResponse.status).toBe(200);
    expect(headResponse.body).toBeNull();
    for (const key of ["Content-Type", "Content-Length", "Content-Disposition", "ETag", "Accept-Ranges"]) {
      expect(headResponse.headers.get(key)).toBe(get.headers.get(key));
    }
  });
});

describe("Range requests", () => {
  it("returns 206 with exactly the requested slice", async () => {
    const response = await download("public-iso", { headers: { Range: "bytes=0-1023" } });
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 0-1023/2048");
    expect(response.headers.get("Content-Length")).toBe("1024");
    expect(body).toHaveLength(1024);
    expect(body.equals(CONTENT.subarray(0, 1024))).toBe(true);
  });

  it("serves an open-ended range to the end of the file", async () => {
    const response = await download("public-iso", { headers: { Range: "bytes=1024-" } });
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.status).toBe(206);
    expect(body.equals(CONTENT.subarray(1024))).toBe(true);
  });

  it("serves a suffix range as the LAST n bytes", async () => {
    const response = await download("public-iso", { headers: { Range: "bytes=-512" } });
    const body = Buffer.from(await response.arrayBuffer());

    expect(response.headers.get("Content-Range")).toBe("bytes 1536-2047/2048");
    expect(body.equals(CONTENT.subarray(1536))).toBe(true);
  });

  it("returns 416 with Content-Range for an unsatisfiable range", async () => {
    const response = await download("public-iso", { headers: { Range: "bytes=99999-" } });

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe("bytes */2048");
  });

  it("ignores a malformed range and sends 200 with the whole file", async () => {
    const response = await download("public-iso", { headers: { Range: "bytes=abc" } });
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("2048");
  });
});

describe("missing and out-of-root files", () => {
  it("returns 410 and flags the tool when the file has gone", async () => {
    const { prisma } = await import("../src/lib/db");
    unlinkSync(join(root, "isos", "gone.iso"));

    const response = await download("vanishing-iso");
    const body = await response.json();

    expect(response.status).toBe(410);
    expect(body.error.code).toBe("FILE_MISSING");
    expect((await prisma.tool.findUniqueOrThrow({ where: { slug: "vanishing-iso" } })).fileMissing).toBe(true);
  });

  it("clears the flag when the file comes back", async () => {
    const { prisma } = await import("../src/lib/db");
    writeFileSync(join(root, "isos", "gone.iso"), "restored");

    expect((await download("vanishing-iso")).status).toBe(200);
    // The clear is fire-and-forget, so give it a turn of the loop.
    await new Promise((r) => setTimeout(r, 50));
    expect((await prisma.tool.findUniqueOrThrow({ where: { slug: "vanishing-iso" } })).fileMissing).toBe(false);
  });

  it("refuses a stored path outside the storage root — the DB is not trusted", async () => {
    // /etc/hosts really exists; only re-validation stops it being served.
    expect((await download("escaped-iso")).status).toBe(410);
  });

  it("serves a zero-byte file as 200 with no body rather than erroring", async () => {
    const response = await download("empty-iso");
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Length")).toBe("0");
  });
});

describe("side effects", () => {
  it("increments downloadCount and sets lastDownloadAt without blocking", async () => {
    const { prisma } = await import("../src/lib/db");
    const before = await prisma.tool.findUniqueOrThrow({ where: { slug: "public-iso" } });

    await download("public-iso");
    await new Promise((r) => setTimeout(r, 50));

    const after = await prisma.tool.findUniqueOrThrow({ where: { slug: "public-iso" } });
    expect(after.downloadCount).toBe(before.downloadCount + 1);
    expect(after.lastDownloadAt).not.toBeNull();
  });

  it("does not leak a file descriptor when the client aborts mid-stream", async () => {
    const controller = new AbortController();
    const response = await download("public-iso", { signal: controller.signal });

    const reader = response.body!.getReader();
    await reader.read();
    controller.abort();

    // The stream must end rather than hold the fd open. Cancelling the reader
    // after an abort should settle promptly, not hang.
    await expect(Promise.race([
      reader.cancel().then(() => "closed"),
      new Promise((r) => setTimeout(() => r("hung"), 2000)),
    ])).resolves.toBe("closed");
  });
});

describe("X-Accel-Redirect", () => {
  it("hands off to the proxy with a URI-encoded path when enabled", async () => {
    process.env.USE_X_ACCEL = "true";
    process.env.X_ACCEL_PREFIX = "/_protected";
    resetEnvCache();
    try {
      const response = await download("public-iso");

      expect(response.status).toBe(200);
      expect(response.body).toBeNull();
      // Separators survive; spaces would not if this used encodeURIComponent.
      expect(response.headers.get("X-Accel-Redirect")).toBe("/_protected/isos/ubuntu.iso");
      expect(response.headers.get("Content-Disposition")).toContain("attachment;");
    } finally {
      process.env.USE_X_ACCEL = "false";
      resetEnvCache();
    }
  });
});
