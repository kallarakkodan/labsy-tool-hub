import { describe, expect, it } from "vitest";
import { contentDisposition, etagFor, parseRange } from "../src/lib/http";

describe("parseRange", () => {
  const size = 2048;

  it("returns none when there is no Range header", () => {
    expect(parseRange(null, size)).toEqual({ kind: "none" });
  });

  it("parses the CONTEXT §9 cases", () => {
    expect(parseRange("bytes=0-1023", size)).toEqual({
      kind: "satisfiable",
      range: { start: 0, end: 1023 },
    });
    expect(parseRange("bytes=1024-", size)).toEqual({
      kind: "satisfiable",
      range: { start: 1024, end: 2047 },
    });
    // A suffix range is the LAST n bytes, not the first n.
    expect(parseRange("bytes=-512", size)).toEqual({
      kind: "satisfiable",
      range: { start: 1536, end: 2047 },
    });
  });

  it("treats a range starting past the end as unsatisfiable", () => {
    expect(parseRange("bytes=2048-", size)).toEqual({ kind: "unsatisfiable" });
    expect(parseRange("bytes=9999-10000", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("clamps an end past the last byte rather than rejecting (RFC 9110)", () => {
    expect(parseRange("bytes=2000-99999", size)).toEqual({
      kind: "satisfiable",
      range: { start: 2000, end: 2047 },
    });
  });

  it("clamps a suffix longer than the file to the whole file", () => {
    expect(parseRange("bytes=-99999", size)).toEqual({
      kind: "satisfiable",
      range: { start: 0, end: 2047 },
    });
  });

  it("rejects a backwards range", () => {
    expect(parseRange("bytes=500-100", size)).toEqual({ kind: "unsatisfiable" });
  });

  it("cannot satisfy any range on an empty file", () => {
    expect(parseRange("bytes=0-0", 0)).toEqual({ kind: "unsatisfiable" });
  });

  it("ignores a malformed or multi-range header and sends the whole file", () => {
    // Always a valid response, and no download manager needs multipart for one artifact.
    expect(parseRange("bytes=0-99,200-299", size)).toEqual({ kind: "none" });
    expect(parseRange("items=0-10", size)).toEqual({ kind: "none" });
    expect(parseRange("bytes=abc", size)).toEqual({ kind: "none" });
    expect(parseRange("bytes=-", size)).toEqual({ kind: "none" });
  });
});

describe("contentDisposition", () => {
  it("always carries both the ASCII fallback and the encoded form", () => {
    const value = contentDisposition("ubuntu-22.04.4-live-server-amd64.iso");
    expect(value).toBe(
      `attachment; filename="ubuntu-22.04.4-live-server-amd64.iso"; ` +
        `filename*=UTF-8''ubuntu-22.04.4-live-server-amd64.iso`,
    );
  });

  it("encodes spaces and parentheses, which real artifact names have", () => {
    const value = contentDisposition("Windows 11 Dev Kit (23H2).iso");
    expect(value).toContain(`filename="Windows 11 Dev Kit (23H2).iso"`);
    expect(value).toContain("filename*=UTF-8''Windows%2011%20Dev%20Kit%20%2823H2%29.iso");
  });

  it("carries non-ASCII in the encoded form and degrades the fallback", () => {
    const value = contentDisposition("Übersicht-Röntgen.iso");
    expect(value).toContain(`filename="_bersicht-R_ntgen.iso"`);
    expect(value).toContain("filename*=UTF-8''%C3%9Cbersicht-R%C3%B6ntgen.iso");
  });

  it("strips quotes so a filename cannot break out of the header parameter", () => {
    const value = contentDisposition('evil".iso; x=y');
    expect(value).toContain(`filename="evil.iso; x=y"`);
    expect(value.match(/"/g)).toHaveLength(2);
  });

  it("falls back to a placeholder only when the fallback empties entirely", () => {
    // A single non-ASCII character still degrades to something ("_").
    expect(contentDisposition("…")).toContain(`filename="_"`);
    // A name made only of stripped characters leaves nothing to quote.
    expect(contentDisposition('"""')).toContain(`filename="download"`);
  });

  it("is always an attachment, so stored HTML can never execute in this origin", () => {
    expect(contentDisposition("payload.html").startsWith("attachment;")).toBe(true);
  });
});

describe("etagFor", () => {
  it("combines size and mtime, and is quoted", () => {
    expect(etagFor(2048, 1_723_459_200_123.7)).toBe('"2048-1723459200123"');
  });

  it("accepts a BigInt size without throwing", () => {
    expect(etagFor(9_007_199_254_740_993n, 1_000)).toBe('"9007199254740993-1000"');
  });

  it("changes when the file changes", () => {
    expect(etagFor(2048, 1_000)).not.toBe(etagFor(2049, 1_000));
    expect(etagFor(2048, 1_000)).not.toBe(etagFor(2048, 2_000));
  });
});
