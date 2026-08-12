import { describe, expect, it } from "vitest";
import {
  EMPTY_ADMIN_FILTERS,
  STALE_AFTER_DAYS,
  applyAdminFilters,
  hasActiveAdminFilters,
  isStale,
  lifecycleStatus,
} from "../src/lib/admin-filters";
import { middleTruncate } from "../src/lib/format";
import type { SerializedAdminTool } from "../src/types";

/*
 * The dashboard's filtering and the retention rule behind the Stale toggle
 * (PRD §8.2, §16 D4). Pure functions, so they are tested here; the table that
 * renders their output is verified in the browser.
 */

const NOW = new Date("2026-08-12T00:00:00Z");
const daysAgo = (days: number) =>
  new Date(NOW.getTime() - days * 24 * 60 * 60 * 1000).toISOString();

function tool(overrides: Partial<SerializedAdminTool> = {}): SerializedAdminTool {
  return {
    id: overrides.slug ?? "id",
    slug: "ubuntu-server",
    name: "Ubuntu 22.04.4 LTS Server",
    description: "Minimal server image with cloud-init and the standard provisioning overlay.",
    category: "OS Images",
    version: "22.04.4",
    fileName: "ubuntu-22.04.4-live-server-amd64.iso",
    filePath: "images/ubuntu-22.04.4-live-server-amd64.iso",
    fileSize: "2100000000",
    mimeType: "application/x-iso9660-image",
    checksum: null,
    checksumAt: null,
    iconUrl: null,
    notes: null,
    published: true,
    visibility: "public",
    featured: false,
    fileMissing: false,
    downloadCount: 12,
    lastDownloadAt: daysAgo(3),
    createdAt: daysAgo(400),
    updatedAt: daysAgo(3),
    ...overrides,
  };
}

describe("isStale (PRD §16 D4)", () => {
  it("treats a tool nobody has ever downloaded as stale", () => {
    expect(isStale(tool({ lastDownloadAt: null }), NOW)).toBe(true);
  });

  it("is false just inside the threshold and true just outside it", () => {
    expect(isStale(tool({ lastDownloadAt: daysAgo(STALE_AFTER_DAYS - 1) }), NOW)).toBe(false);
    expect(isStale(tool({ lastDownloadAt: daysAgo(STALE_AFTER_DAYS + 1) }), NOW)).toBe(true);
  });

  it("is a named policy, not an inlined number", () => {
    expect(STALE_AFTER_DAYS).toBe(180);
  });
});

describe("applyAdminFilters — Stale", () => {
  const fresh = tool({ slug: "fresh", lastDownloadAt: daysAgo(2) });
  const idle = tool({ slug: "idle", lastDownloadAt: daysAgo(200) });
  const ancient = tool({ slug: "ancient", lastDownloadAt: daysAgo(900) });
  const never = tool({ slug: "never", lastDownloadAt: null });
  const all = [fresh, idle, never, ancient];

  it("lists never-downloaded and long-idle tools, oldest first (PRD §14)", () => {
    const result = applyAdminFilters(all, { ...EMPTY_ADMIN_FILTERS, stale: true }, NOW);

    expect(result.map((t) => t.slug)).toEqual(["never", "ancient", "idle"]);
  });

  it("leaves the order alone when the toggle is off", () => {
    const result = applyAdminFilters(all, EMPTY_ADMIN_FILTERS, NOW);
    expect(result.map((t) => t.slug)).toEqual(["fresh", "idle", "never", "ancient"]);
  });

  it("composes with the other filters rather than replacing them", () => {
    const other = tool({ slug: "other", category: "Drivers", lastDownloadAt: null });
    const result = applyAdminFilters(
      [...all, other],
      { q: "", category: "Drivers", stale: true },
      NOW,
    );

    expect(result.map((t) => t.slug)).toEqual(["other"]);
  });
});

describe("applyAdminFilters — search", () => {
  const iso = tool({ slug: "iso", name: "Ubuntu Server", fileName: "ubuntu.iso", filePath: "images/ubuntu.iso" });
  const msi = tool({
    slug: "msi",
    name: "Node.js Installer",
    fileName: "node-v22.msi",
    filePath: "installers/node-v22.msi",
    version: "22.11.0",
    category: "Dev Tools",
  });

  it("matches the filename and the path, not just the name", () => {
    expect(applyAdminFilters([iso, msi], { ...EMPTY_ADMIN_FILTERS, q: "installers/" }, NOW)).toEqual([msi]);
    expect(applyAdminFilters([iso, msi], { ...EMPTY_ADMIN_FILTERS, q: ".iso" }, NOW)).toEqual([iso]);
  });

  it("matches the version and category", () => {
    expect(applyAdminFilters([iso, msi], { ...EMPTY_ADMIN_FILTERS, q: "22.11" }, NOW)).toEqual([msi]);
    expect(applyAdminFilters([iso, msi], { ...EMPTY_ADMIN_FILTERS, q: "dev tools" }, NOW)).toEqual([msi]);
  });

  it("is case-insensitive and ignores surrounding whitespace", () => {
    expect(applyAdminFilters([iso, msi], { ...EMPTY_ADMIN_FILTERS, q: "  UBUNTU  " }, NOW)).toEqual([iso]);
  });
});

describe("hasActiveAdminFilters", () => {
  it("counts the Stale toggle, so the empty state can offer to clear it", () => {
    expect(hasActiveAdminFilters(EMPTY_ADMIN_FILTERS)).toBe(false);
    expect(hasActiveAdminFilters({ ...EMPTY_ADMIN_FILTERS, stale: true })).toBe(true);
    expect(hasActiveAdminFilters({ ...EMPTY_ADMIN_FILTERS, q: "   " })).toBe(false);
  });
});

describe("lifecycleStatus (PRD §8.2)", () => {
  it("names the four states the chips render", () => {
    expect(lifecycleStatus(tool())).toBe("published");
    expect(lifecycleStatus(tool({ published: false }))).toBe("draft");
    expect(lifecycleStatus(tool({ fileMissing: true }))).toBe("missing");
  });

  it("lets Missing win over Draft — broken bytes outrank not-yet-published", () => {
    expect(lifecycleStatus(tool({ published: false, fileMissing: true }))).toBe("missing");
  });

  it("leaves Internal to the second chip, because the axes are independent", () => {
    // A tool can be a draft *and* internal (CONTEXT §2 item 7); collapsing the
    // two would hide one of the reasons it is not on the public site.
    expect(lifecycleStatus(tool({ published: false, visibility: "admin" }))).toBe("draft");
  });
});

describe("middleTruncate (the Path column)", () => {
  it("keeps both ends, which is where the information is", () => {
    // The directory it lives in and the extension both survive; the version
    // string in the middle is what goes.
    expect(middleTruncate("images/ubuntu-22.04.4-live-server-amd64.iso", 20)).toBe(
      "images/ubu…amd64.iso",
    );
  });

  it("leaves a path that already fits untouched", () => {
    expect(middleTruncate("seed/node.msi", 32)).toBe("seed/node.msi");
    expect(middleTruncate("", 10)).toBe("");
  });

  it("never exceeds the budget", () => {
    for (const max of [3, 8, 16, 33]) {
      expect(middleTruncate("a".repeat(200), max).length).toBeLessThanOrEqual(max);
    }
  });
});
