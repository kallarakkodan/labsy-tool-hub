import { describe, expect, it } from "vitest";
import {
  browseQuerySchema,
  normalizeCategory,
  sanitizeFileName,
  slugify,
  toolCreateSchema,
  toolUpdateSchema,
  toolsQuerySchema,
  uploadInitSchema,
} from "../src/lib/validation";

const validCreate = {
  name: "Ubuntu 22.04.4 LTS Server",
  description: "Minimal server image with cloud-init and the standard Labsy provisioning overlay.",
  category: "OS Images",
  version: "22.04.4",
  file: { source: "serverPath", relativePath: "isos/ubuntu-22.04.4-live-server-amd64.iso" },
};

describe("sanitizeFileName", () => {
  it("reduces a traversal to a basename", () => {
    expect(sanitizeFileName("../../evil.sh")).toBe("evil.sh");
    expect(sanitizeFileName("..\\..\\evil.sh")).toBe("evil.sh");
    expect(sanitizeFileName("/etc/passwd")).toBe("passwd");
  });

  it("strips leading dots so an upload cannot create a dotfile", () => {
    expect(sanitizeFileName(".uploads")).toBe("uploads");
    expect(sanitizeFileName("...hidden.iso")).toBe("hidden.iso");
  });

  it("strips control characters, including a null byte", () => {
    expect(sanitizeFileName("foo\u0000.iso")).toBe("foo.iso");
    expect(sanitizeFileName("re\u001bport.zip")).toBe("report.zip");
  });

  it("keeps spaces and parentheses, which real artifact names contain", () => {
    expect(sanitizeFileName("Windows 11 Dev Kit (23H2).iso")).toBe("Windows 11 Dev Kit (23H2).iso");
  });
});

describe("normalizeCategory", () => {
  it("title-cases and collapses whitespace so the same category cannot appear twice", () => {
    expect(normalizeCategory("  os   images ")).toBe("Os Images");
    expect(normalizeCategory("DRIVERS")).toBe("Drivers");
    expect(normalizeCategory("dev tools")).toBe("Dev Tools");
  });

  it("is idempotent, so re-saving a tool does not churn the value", () => {
    expect(normalizeCategory(normalizeCategory("os images"))).toBe(normalizeCategory("os images"));
  });
});

describe("slugify", () => {
  it("derives a url-safe slug from a name", () => {
    expect(slugify("Ubuntu 22.04.4 LTS Server")).toBe("ubuntu-22-04-4-lts-server");
    expect(slugify("Node.js 22 LTS Offline Installer")).toBe("node-js-22-lts-offline-installer");
  });

  it("folds accents rather than dropping the whole word", () => {
    expect(slugify("Café Deployer")).toBe("cafe-deployer");
  });

  it("never leaves leading or trailing hyphens", () => {
    expect(slugify("  ...Ventoy!  ")).toBe("ventoy");
  });
});

describe("toolCreateSchema", () => {
  it("accepts a valid server-path tool and normalises the category", () => {
    const parsed = toolCreateSchema.parse({ ...validCreate, category: "  os images  " });
    expect(parsed.category).toBe("Os Images");
  });

  it("rejects a name shorter than 2 or longer than 80", () => {
    expect(toolCreateSchema.safeParse({ ...validCreate, name: "U" }).success).toBe(false);
    expect(toolCreateSchema.safeParse({ ...validCreate, name: "U".repeat(81) }).success).toBe(false);
  });

  it("rejects a description over 280 characters", () => {
    expect(toolCreateSchema.safeParse({ ...validCreate, description: "x".repeat(281) }).success).toBe(false);
  });

  it("requires a file source, since a tool without bytes is not a tool", () => {
    const withoutSource = { ...validCreate, file: undefined };
    expect(toolCreateSchema.safeParse(withoutSource).success).toBe(false);
  });

  it("accepts either source but not a hybrid", () => {
    expect(
      toolCreateSchema.safeParse({ ...validCreate, file: { source: "upload", uploadId: "clx1" } }).success,
    ).toBe(true);
    expect(
      toolCreateSchema.safeParse({ ...validCreate, file: { source: "nonsense", uploadId: "clx1" } }).success,
    ).toBe(false);
  });

  it("strips unknown keys rather than passing them through to Prisma", () => {
    const parsed = toolCreateSchema.parse({ ...validCreate, downloadCount: 9999, isSeed: true });
    expect(parsed).not.toHaveProperty("downloadCount");
    expect(parsed).not.toHaveProperty("isSeed");
  });

  it("accepts an http(s) or root-relative icon and rejects anything else", () => {
    expect(toolCreateSchema.safeParse({ ...validCreate, iconUrl: "https://x/i.png" }).success).toBe(true);
    expect(toolCreateSchema.safeParse({ ...validCreate, iconUrl: "/uploads/icons/i.png" }).success).toBe(true);
    expect(toolCreateSchema.safeParse({ ...validCreate, iconUrl: "javascript:alert(1)" }).success).toBe(false);
  });

  it("rejects a slug that is not url-safe", () => {
    expect(toolCreateSchema.safeParse({ ...validCreate, slug: "Not A Slug" }).success).toBe(false);
    expect(toolCreateSchema.safeParse({ ...validCreate, slug: "-leading" }).success).toBe(false);
    expect(toolCreateSchema.safeParse({ ...validCreate, slug: "fine-slug-2" }).success).toBe(true);
  });
});

describe("toolUpdateSchema", () => {
  it("accepts a single field, which is what the Published switch sends", () => {
    const parsed = toolUpdateSchema.parse({ published: false });
    expect(parsed.published).toBe(false);
  });

  it("still enforces the constraints on whatever is sent", () => {
    expect(toolUpdateSchema.safeParse({ name: "U" }).success).toBe(false);
  });
});

describe("toolsQuerySchema", () => {
  it("defaults to newest, page 1, limit 100", () => {
    expect(toolsQuerySchema.parse({})).toMatchObject({ sort: "newest", page: 1, limit: 100 });
  });

  it("coerces the numeric query params browsers send as strings", () => {
    expect(toolsQuerySchema.parse({ page: "3", limit: "20" })).toMatchObject({ page: 3, limit: 20 });
  });

  it("rejects an unknown sort rather than silently falling back", () => {
    expect(toolsQuerySchema.safeParse({ sort: "downloads" }).success).toBe(false);
  });

  it("caps limit so a client cannot ask for the whole table", () => {
    expect(toolsQuerySchema.safeParse({ limit: "100000" }).success).toBe(false);
  });
});

describe("browseQuerySchema", () => {
  it("defaults to the storage root with hidden files off", () => {
    expect(browseQuerySchema.parse({})).toEqual({ path: "", showHidden: false });
  });

  it("treats showHidden as a flag, not a truthy string", () => {
    expect(browseQuerySchema.parse({ showHidden: "true" }).showHidden).toBe(true);
    expect(browseQuerySchema.parse({ showHidden: "false" }).showHidden).toBe(false);
  });

  it("does not itself judge traversal — that is resolveWithinRoot's job", () => {
    // Accepted here, rejected by the storage boundary. Two places deciding what
    // a safe path is would be one place too many.
    expect(browseQuerySchema.safeParse({ path: "../../etc" }).success).toBe(true);
  });
});

describe("uploadInitSchema", () => {
  it("sanitises the filename and parses the size as BigInt", () => {
    const parsed = uploadInitSchema.parse({ fileName: "../../evil.sh", totalSize: "9007199254740993" });

    expect(parsed.fileName).toBe("evil.sh");
    expect(parsed.totalSize).toBe(9_007_199_254_740_993n);
  });

  it("rejects a numeric totalSize, which would reintroduce the double", () => {
    expect(uploadInitSchema.safeParse({ fileName: "a.zip", totalSize: 1024 }).success).toBe(false);
  });

  it("rejects a zero-byte or negative upload", () => {
    expect(uploadInitSchema.safeParse({ fileName: "a.zip", totalSize: "0" }).success).toBe(false);
    expect(uploadInitSchema.safeParse({ fileName: "a.zip", totalSize: "-1" }).success).toBe(false);
  });

  it("rejects a filename that sanitises away to nothing", () => {
    expect(uploadInitSchema.safeParse({ fileName: "...", totalSize: "10" }).success).toBe(false);
  });
});
