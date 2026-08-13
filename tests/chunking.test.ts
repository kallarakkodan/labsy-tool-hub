import { describe, expect, it } from "vitest";
import { expectedChunkSize } from "../src/lib/chunking";

/*
 * The one formula the upload protocol's server-side pre-flight
 * (`verifyUploadParts`) and the client's resume byte-accounting
 * (`UploadDropzone`) both depend on agreeing on (issue 31, PRD §9.5) — an
 * off-by-one here either fails every legitimate upload at the last chunk or
 * silently accepts a short one.
 */

describe("expectedChunkSize", () => {
  it("is chunkSize for every full chunk", () => {
    // 3 chunks of 1000 bytes = 3000 total, nothing short.
    expect(expectedChunkSize(0, 3, 1000, 3000)).toBe(1000);
    expect(expectedChunkSize(1, 3, 1000, 3000)).toBe(1000);
  });

  it("is the remainder for a short final chunk", () => {
    // 2 full 1000-byte chunks + a 300-byte final chunk.
    expect(expectedChunkSize(0, 3, 1000, 2300)).toBe(1000);
    expect(expectedChunkSize(1, 3, 1000, 2300)).toBe(1000);
    expect(expectedChunkSize(2, 3, 1000, 2300)).toBe(300);
  });

  it("is exactly chunkSize when the total divides evenly, including the last index", () => {
    expect(expectedChunkSize(2, 3, 1000, 3000)).toBe(1000);
  });

  it("handles a single-chunk upload", () => {
    expect(expectedChunkSize(0, 1, 16_777_216, 5_242_880)).toBe(5_242_880);
  });

  it("matches realistic sizes at the default 16 MiB chunk size", () => {
    const chunkSize = 16_777_216;
    const totalSize = 8 * 1_000_000_000; // an 8 GB upload
    const totalChunks = Math.ceil(totalSize / chunkSize);

    let sum = 0;
    for (let i = 0; i < totalChunks; i++) sum += expectedChunkSize(i, totalChunks, chunkSize, totalSize);

    expect(sum).toBe(totalSize);
    // Every chunk before the last is exactly chunkSize.
    for (let i = 0; i < totalChunks - 1; i++) {
      expect(expectedChunkSize(i, totalChunks, chunkSize, totalSize)).toBe(chunkSize);
    }
    expect(expectedChunkSize(totalChunks - 1, totalChunks, chunkSize, totalSize)).toBeLessThanOrEqual(chunkSize);
    expect(expectedChunkSize(totalChunks - 1, totalChunks, chunkSize, totalSize)).toBeGreaterThan(0);
  });
});
