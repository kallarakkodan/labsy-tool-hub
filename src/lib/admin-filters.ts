import type { SerializedAdminTool } from "@/types";

/*
 * Dashboard filter state and the retention rule behind it (PRD §8.2, §16 D4).
 *
 * The public catalogue has its own filters in `lib/filters.ts`; these are not
 * the same set and deliberately do not share a type. The admin surface filters
 * over rows the public one cannot see at all, and its extra control — Stale — is
 * a retention question, not a browsing one.
 */

/**
 * D4's threshold. Named rather than inlined because it is a **policy**, not a
 * magic number: it is the line between "we still use this" and "somebody should
 * look at whether we still need it", and the person who wants to move it to 90
 * should find one constant.
 */
export const STALE_AFTER_DAYS = 180;

const STALE_AFTER_MS = STALE_AFTER_DAYS * 24 * 60 * 60 * 1000;

export interface AdminFilters {
  q: string;
  category: string | null;
  stale: boolean;
}

export const EMPTY_ADMIN_FILTERS: AdminFilters = { q: "", category: null, stale: false };

/**
 * Never downloaded, or not downloaded in 180 days.
 *
 * "Never" counts as stale and is not an edge case to tidy away — a tool nobody
 * has ever fetched is the strongest candidate the retention review has, and
 * treating null as "no evidence, leave it alone" would hide exactly the rows
 * D4 exists to surface.
 */
export function isStale(tool: SerializedAdminTool, now: Date = new Date()): boolean {
  if (tool.lastDownloadAt === null) return true;
  return now.getTime() - new Date(tool.lastDownloadAt).getTime() > STALE_AFTER_MS;
}

export function hasActiveAdminFilters(filters: AdminFilters): boolean {
  return filters.q.trim() !== "" || filters.category !== null || filters.stale;
}

/**
 * Search, category, and Stale, applied in memory over the already-hydrated list
 * (CONTEXT §6 — the catalogue is tens of items).
 *
 * The Stale filter also **orders** its result oldest-first, which the other
 * filters do not. That is PRD §14's wording and it is the useful behaviour: the
 * point of turning it on is to work down a list, so the row most in need of a
 * decision belongs at the top. Column sorting still applies on top of this; the
 * order here is what the table sees before anyone clicks a header.
 */
export function applyAdminFilters(
  tools: SerializedAdminTool[],
  filters: AdminFilters,
  now: Date = new Date(),
): SerializedAdminTool[] {
  const needle = filters.q.trim().toLowerCase();

  const matched = tools.filter((tool) => {
    if (filters.category !== null && tool.category !== filters.category) return false;
    if (filters.stale && !isStale(tool, now)) return false;
    if (needle === "") return true;

    return (
      tool.name.toLowerCase().includes(needle) ||
      tool.fileName.toLowerCase().includes(needle) ||
      tool.filePath.toLowerCase().includes(needle) ||
      tool.category.toLowerCase().includes(needle) ||
      tool.version.toLowerCase().includes(needle)
    );
  });

  return filters.stale ? matched.sort(byIdlestFirst) : matched;
}

/** Never-downloaded first, then longest-idle. */
function byIdlestFirst(a: SerializedAdminTool, b: SerializedAdminTool): number {
  if (a.lastDownloadAt === null && b.lastDownloadAt === null) return 0;
  if (a.lastDownloadAt === null) return -1;
  if (b.lastDownloadAt === null) return 1;
  return a.lastDownloadAt.localeCompare(b.lastDownloadAt);
}

/*
 * The status chips (PRD §8.2).
 *
 * Two axes, rendered as up to two chips rather than one. `published` and
 * `visibility` are independent (CONTEXT §2 item 7), so a tool can be a draft
 * *and* internal, and collapsing that into a single chip would hide one of the
 * two reasons it is not on the public site — on the one screen whose job is to
 * explain exactly that. The public card already badges both this way (issue 15).
 *
 * `fileMissing` replaces the lifecycle chip rather than joining it: a row whose
 * bytes are gone is broken, and "Published" alongside "Missing" reads as a
 * contradiction when it is really a sequence.
 */
export type LifecycleStatus = "published" | "draft" | "missing";

export function lifecycleStatus(tool: SerializedAdminTool): LifecycleStatus {
  if (tool.fileMissing) return "missing";
  return tool.published ? "published" : "draft";
}
