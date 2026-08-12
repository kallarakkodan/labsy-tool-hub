import { describe, expect, it } from "vitest";
import { formatBytes, formatDate, formatEta, formatRelativeDate, formatThroughput } from "../src/lib/format";

describe("formatBytes", () => {
  it("uses decimal units so a card matches the vendor's own download page", () => {
    // Ubuntu ships 22.04.4 as "2.1 GB"; the same file is 1.96 GiB.
    expect(formatBytes(2_101_346_304n)).toBe("2.1 GB");
  });

  it("renders the PRD §15 seed sizes as the PRD writes them", () => {
    expect(formatBytes(84_000_000n)).toBe("84.0 MB");
    expect(formatBytes(412_000_000n)).toBe("412.0 MB");
    expect(formatBytes(5_800_000_000n)).toBe("5.8 GB");
  });

  it("leaves byte counts under 1 kB unscaled", () => {
    expect(formatBytes(0n)).toBe("0 B");
    expect(formatBytes(999n)).toBe("999 B");
    expect(formatBytes(1000n)).toBe("1.0 kB");
  });

  it("formats a size above 2^53 without losing precision to a double", () => {
    // 9007199254740993 bytes = 9.0 PB. The point is that it does not throw or
    // silently round through Number() on the way.
    expect(formatBytes(9_007_199_254_740_993n)).toBe("9.0 PB");
  });

  it("accepts the string form that survives the API boundary", () => {
    expect(formatBytes("2101346304")).toBe("2.1 GB");
    expect(formatBytes(2_101_346_304)).toBe("2.1 GB");
  });

  it("handles negatives, which only appear from a bad diff but should not render as garbage", () => {
    expect(formatBytes(-1500n)).toBe("-1.5 kB");
  });
});

describe("formatDate", () => {
  it("renders the card's Added line", () => {
    expect(formatDate(new Date("2026-08-12T10:00:00.000Z"))).toBe("12 Aug 2026");
  });

  it("accepts the ISO string form", () => {
    expect(formatDate("2026-08-12T10:00:00.000Z")).toBe("12 Aug 2026");
  });
});

describe("formatRelativeDate", () => {
  const now = new Date("2026-08-12T12:00:00.000Z");

  it("renders Never for a tool nobody has downloaded — a real Stale-filter state", () => {
    expect(formatRelativeDate(null, now)).toBe("Never");
  });

  it("scales through the units", () => {
    expect(formatRelativeDate(new Date("2026-08-12T11:59:30.000Z"), now)).toContain("second");
    expect(formatRelativeDate(new Date("2026-08-12T11:30:00.000Z"), now)).toContain("minute");
    expect(formatRelativeDate(new Date("2026-08-12T09:00:00.000Z"), now)).toContain("hour");
    expect(formatRelativeDate(new Date("2026-08-09T12:00:00.000Z"), now)).toBe("3 days ago");
    expect(formatRelativeDate(new Date("2026-02-12T12:00:00.000Z"), now)).toContain("month");
  });

  it("handles the 180-day threshold the Stale filter is built on", () => {
    expect(formatRelativeDate(new Date("2026-01-01T12:00:00.000Z"), now)).toContain("month");
  });
});

describe("formatThroughput", () => {
  it("renders a rate", () => {
    expect(formatThroughput(12_400_000)).toBe("12.4 MB/s");
  });

  it("renders an em dash rather than Infinity or NaN before the first sample", () => {
    expect(formatThroughput(0)).toBe("—");
    expect(formatThroughput(Number.NaN)).toBe("—");
    expect(formatThroughput(Number.POSITIVE_INFINITY)).toBe("—");
  });
});

describe("formatEta", () => {
  it("stays coarse — a second-accurate ETA on an 8 GB upload is noise", () => {
    expect(formatEta(45)).toBe("45s");
    expect(formatEta(134)).toBe("2m 14s");
    expect(formatEta(7_200)).toBe("2h 0m");
  });

  it("renders an em dash when there is nothing to estimate from", () => {
    expect(formatEta(Number.POSITIVE_INFINITY)).toBe("—");
    expect(formatEta(-1)).toBe("—");
  });
});
