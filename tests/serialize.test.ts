import { describe, expect, it } from "vitest";
import type { Tool, Upload } from "../src/generated/prisma/client";
import { parseReceived, serializeAdminTool, serializeTool, serializeUpload } from "../src/lib/serialize";

/** 2^53 + 1 — the first integer a JavaScript double cannot represent. */
const HUGE = 9_007_199_254_740_993n;

function tool(overrides: Partial<Tool> = {}): Tool {
  return {
    id: "clx0000000000000000000000",
    slug: "ubuntu-22-04-4-lts-server",
    name: "Ubuntu 22.04.4 LTS Server",
    description: "Minimal server image with cloud-init and the standard Labsy provisioning overlay.",
    category: "OS Images",
    version: "22.04.4",
    filePath: "/srv/downloads/isos/ubuntu-22.04.4-live-server-amd64.iso",
    fileName: "ubuntu-22.04.4-live-server-amd64.iso",
    fileSize: 2_306_867_200n,
    mimeType: "application/octet-stream",
    checksum: null,
    checksumAt: null,
    iconUrl: null,
    notes: null,
    published: true,
    visibility: "public",
    featured: false,
    isSeed: false,
    fileMissing: false,
    downloadCount: 0,
    lastDownloadAt: null,
    createdAt: new Date("2026-08-12T10:00:00.000Z"),
    updatedAt: new Date("2026-08-12T10:00:00.000Z"),
    ...overrides,
  };
}

describe("serializeTool", () => {
  it("survives JSON.stringify, which a raw Prisma tool does not", () => {
    expect(() => JSON.stringify(tool())).toThrow(TypeError);
    expect(() => JSON.stringify(serializeTool(tool()))).not.toThrow();
  });

  it("round-trips a fileSize above 2^53 with no precision loss", () => {
    const serialized = serializeTool(tool({ fileSize: HUGE }));
    const throughTheWire = JSON.parse(JSON.stringify(serialized)) as { fileSize: string };

    expect(throughTheWire.fileSize).toBe("9007199254740993");
    expect(BigInt(throughTheWire.fileSize)).toBe(HUGE);
    // The failure this guards against: the same value via Number() is wrong by one.
    expect(Number(throughTheWire.fileSize)).toBe(9_007_199_254_740_992);
  });

  it("never carries the absolute host path", () => {
    const serialized = serializeTool(tool());

    expect(JSON.stringify(serialized)).not.toContain("/srv/downloads");
    expect(serialized).not.toHaveProperty("filePath");
  });

  it("omits isSeed, which is an operational flag and not the client's business", () => {
    expect(serializeTool(tool({ isSeed: true }))).not.toHaveProperty("isSeed");
  });

  it("renders dates as ISO strings and keeps nulls null", () => {
    const serialized = serializeTool(tool({ lastDownloadAt: new Date("2026-01-02T03:04:05.000Z") }));

    expect(serialized.createdAt).toBe("2026-08-12T10:00:00.000Z");
    expect(serialized.lastDownloadAt).toBe("2026-01-02T03:04:05.000Z");
    expect(serialized.checksumAt).toBeNull();
  });

  it("carries the badge flags an admin needs to see Draft and Internal", () => {
    const draft = serializeTool(tool({ published: false }));
    const internal = serializeTool(tool({ visibility: "admin" }));

    expect(draft.published).toBe(false);
    expect(internal.visibility).toBe("admin");
  });
});

describe("serializeAdminTool", () => {
  it("adds the path it is given, not the one on the row", () => {
    const serialized = serializeAdminTool(tool(), "isos/ubuntu-22.04.4-live-server-amd64.iso");

    expect(serialized.filePath).toBe("isos/ubuntu-22.04.4-live-server-amd64.iso");
    expect(JSON.stringify(serialized)).not.toContain("/srv/downloads");
  });
});

describe("serializeUpload", () => {
  const upload = (overrides: Partial<Upload> = {}): Upload => ({
    id: "clx1111111111111111111111",
    fileName: "labsy-deployer-3.1.0.zip",
    totalSize: HUGE,
    chunkSize: 16_777_216,
    totalChunks: 537,
    received: "[0,1,2]",
    tempDir: "/srv/downloads/.uploads/clx1111111111111111111111",
    status: "pending",
    finalPath: null,
    checksum: null,
    createdAt: new Date("2026-08-12T10:00:00.000Z"),
    expiresAt: new Date("2026-08-13T10:00:00.000Z"),
    ...overrides,
  });

  it("stringifies totalSize and parses the received array", () => {
    const serialized = serializeUpload(upload());

    expect(() => JSON.stringify(serialized)).not.toThrow();
    expect(serialized.totalSize).toBe("9007199254740993");
    expect(serialized.received).toEqual([0, 1, 2]);
  });

  it("never carries tempDir, which is an absolute host path", () => {
    expect(JSON.stringify(serializeUpload(upload()))).not.toContain("/srv/downloads");
  });
});

describe("parseReceived", () => {
  it("reads a well-formed array", () => {
    expect(parseReceived("[0,1,5]")).toEqual([0, 1, 5]);
  });

  it("degrades to empty rather than throwing, so a resume re-uploads instead of 500-ing", () => {
    expect(parseReceived("not json")).toEqual([]);
    expect(parseReceived('{"a":1}')).toEqual([]);
    expect(parseReceived("")).toEqual([]);
  });

  it("drops non-integer entries", () => {
    expect(parseReceived('[0,"1",2.5,null,3]')).toEqual([0, 3]);
  });
});
