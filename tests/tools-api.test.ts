import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { resetEnvCache } from "../src/lib/env";

/*
 * CONTEXT §9 requires a visibility case per read path. This is the first two:
 * GET /api/tools and GET /api/tools/[id].
 *
 * `isAdmin` is mocked rather than driven through a real session — issue 18 owns
 * the session, and mocking it here keeps this file about *scoping*, which is the
 * thing that leaks.
 */

const repoRoot = resolve(import.meta.dirname, "..");
let dir: string;
let adminMode = false;

vi.mock("../src/lib/auth", () => ({ isAdmin: () => Promise.resolve(adminMode) }));

const baseTool = {
  description: "Minimal server image with cloud-init and the standard Labsy provisioning overlay.",
  version: "22.04.4",
  filePath: "/srv/downloads/x.iso",
  fileName: "x.iso",
};

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "labsy-tools-api-"));
  const dbUrl = `file:${join(dir, "tools.db")}`;
  execFileSync("npx", ["prisma", "db", "push", "--url", dbUrl], { cwd: repoRoot, stdio: "pipe" });

  process.env.STORAGE_ROOT = dir;
  process.env.DATABASE_URL = dbUrl;
  process.env.ADMIN_PASSWORD_HASH = "scrypt$placeholder";
  process.env.AUTH_SECRET = "x".repeat(32);
  resetEnvCache();

  const { prisma } = await import("../src/lib/db");
  await prisma.tool.createMany({
    data: [
      { ...baseTool, slug: "public-iso", name: "Public ISO", category: "OS Images", fileSize: 300n },
      { ...baseTool, slug: "big-iso", name: "Big ISO", category: "OS Images", fileSize: 9_007_199_254_740_993n },
      { ...baseTool, slug: "a-utility", name: "A Utility", category: "Utilities", fileSize: 100n },
      { ...baseTool, slug: "draft-iso", name: "Draft ISO", category: "OS Images", fileSize: 200n, published: false },
      {
        ...baseTool,
        slug: "internal-driver",
        name: "Internal Driver",
        category: "Drivers",
        fileSize: 400n,
        visibility: "admin",
      },
    ],
  });
});

afterAll(() => {
  adminMode = false;
  rmSync(dir, { recursive: true, force: true });
});

async function getList(query = "") {
  const { GET } = await import("../src/app/api/tools/route");
  const response = await GET(new Request(`http://lan.test/api/tools${query}`));
  return { response, body: await response.json() };
}

async function getOne(idOrSlug: string) {
  const { GET } = await import("../src/app/api/tools/[id]/route");
  const response = await GET(new Request("http://lan.test/api/tools/x"), {
    params: Promise.resolve({ id: idOrSlug }),
  });
  return { response, body: await response.json() };
}

describe("GET /api/tools — visibility", () => {
  it("excludes drafts and internal tools from an anonymous caller", async () => {
    adminMode = false;
    const { body } = await getList();

    const slugs = body.tools.map((t: { slug: string }) => t.slug);
    expect(slugs).not.toContain("draft-iso");
    expect(slugs).not.toContain("internal-driver");
    expect(body.total).toBe(3);
  });

  it("shows both to an admin, flagged so the UI can badge them", async () => {
    adminMode = true;
    const { body } = await getList();

    expect(body.total).toBe(5);
    const draft = body.tools.find((t: { slug: string }) => t.slug === "draft-iso");
    const internal = body.tools.find((t: { slug: string }) => t.slug === "internal-driver");
    expect(draft.published).toBe(false);
    expect(internal.visibility).toBe("admin");
    adminMode = false;
  });

  it("does not let an internal tool inflate a public category count", async () => {
    adminMode = false;
    const { body } = await getList();

    // "Drivers" holds only the internal tool, so it must not appear at all.
    expect(body.categories.map((c: { name: string }) => c.name)).not.toContain("Drivers");
    // "OS Images" has 3 rows but only 2 are visible.
    expect(body.categories).toContainEqual({ name: "OS Images", count: 2 });
  });

  it("cannot be talked into admin scope by a query parameter", async () => {
    adminMode = false;
    const { body } = await getList("?isAdmin=true&admin=1&visibility=admin");
    expect(body.total).toBe(3);
  });
});

describe("GET /api/tools — querying", () => {
  it("filters by category", async () => {
    const { body } = await getList("?category=Utilities");
    expect(body.tools).toHaveLength(1);
    expect(body.tools[0].slug).toBe("a-utility");
  });

  it("searches name, description, category, and version", async () => {
    expect((await getList("?q=Utility")).body.tools).toHaveLength(1);
    expect((await getList("?q=cloud-init")).body.tools).toHaveLength(3); // description, all visible
    expect((await getList("?q=Utilities")).body.tools).toHaveLength(1); // category
    expect((await getList("?q=22.04.4")).body.tools).toHaveLength(3); // version
  });

  it("sorts by size numerically, not lexicographically", async () => {
    const { body } = await getList("?sort=size");
    // A string sort would put "300" ahead of "9007199254740993".
    expect(body.tools[0].slug).toBe("big-iso");
    expect(body.tools[0].fileSize).toBe("9007199254740993");
  });

  it("sorts by name", async () => {
    const { body } = await getList("?sort=name");
    expect(body.tools.map((t: { slug: string }) => t.slug)).toEqual(["a-utility", "big-iso", "public-iso"]);
  });

  it("paginates while reporting the unpaginated total", async () => {
    const { body } = await getList("?limit=2&page=2&sort=name");
    expect(body.tools).toHaveLength(1);
    expect(body.total).toBe(3);
  });

  it("rejects an unknown sort with a 400 rather than silently defaulting", async () => {
    const { response, body } = await getList("?sort=downloads");
    expect(response.status).toBe(400);
    expect(body.error.code).toBe("VALIDATION_FAILED");
  });

  it("serialises fileSize as a string, so the response survives JSON", async () => {
    const { body } = await getList();
    expect(typeof body.tools[0].fileSize).toBe("string");
  });

  it("never includes a host path", async () => {
    const { body } = await getList();
    expect(JSON.stringify(body)).not.toContain("/srv/downloads");
    expect(body.tools[0]).not.toHaveProperty("filePath");
  });
});

describe("GET /api/tools/[id]", () => {
  it("resolves by slug and by id", async () => {
    const bySlug = await getOne("public-iso");
    expect(bySlug.response.status).toBe(200);

    const byId = await getOne(bySlug.body.id);
    expect(byId.body.slug).toBe("public-iso");
  });

  it("returns 404 — not 403 — for a draft, so existence is not confirmed", async () => {
    adminMode = false;
    const { response, body } = await getOne("draft-iso");

    expect(response.status).toBe(404);
    expect(body.error.code).toBe("NOT_FOUND");
  });

  it("returns 404 — not 403 — for an internal tool", async () => {
    adminMode = false;
    const { response } = await getOne("internal-driver");
    expect(response.status).toBe(404);
  });

  it("gives an admin the internal tool", async () => {
    adminMode = true;
    const { response, body } = await getOne("internal-driver");
    expect(response.status).toBe(200);
    expect(body.visibility).toBe("admin");
    adminMode = false;
  });

  it("returns the same 404 for a tool that does not exist at all", async () => {
    const missing = await getOne("no-such-tool");
    const internal = await getOne("internal-driver");
    expect(missing.response.status).toBe(internal.response.status);
    expect(missing.body).toEqual(internal.body);
  });
});
