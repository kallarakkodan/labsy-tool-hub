import type { SerializedTool } from "@/types";

/*
 * Catalogue filter state.
 *
 * The URL is the single source of truth (PRD §7.2, §13 row 9): engineers paste
 * filtered links to each other, and a reload has to restore the same view.
 * Writes go through `window.history.replaceState`, which Next syncs into
 * `useSearchParams` without a server round trip — the catalogue is tens of
 * items, so filtering is client-side over an already-hydrated list (CONTEXT §6).
 */

export const SORTS = ["newest", "name", "size"] as const;
export type Sort = (typeof SORTS)[number];

export const SORT_LABELS: Record<Sort, string> = {
  newest: "Newest",
  name: "Name A–Z",
  size: "Largest",
};

export interface Filters {
  q: string;
  category: string | null;
  sort: Sort;
}

export const EMPTY_FILTERS: Filters = { q: "", category: null, sort: "newest" };

export function filtersFromParams(params: URLSearchParams | ReadonlyURLSearchParamsLike): Filters {
  const sort = params.get("sort");
  return {
    q: params.get("q") ?? "",
    category: params.get("category"),
    sort: isSort(sort) ? sort : "newest",
  };
}

/**
 * Only non-default values are written, so the common case is a clean `/` rather
 * than `/?q=&category=&sort=newest`.
 */
export function paramsFromFilters(filters: Filters): string {
  const params = new URLSearchParams();
  if (filters.q.trim() !== "") params.set("q", filters.q);
  if (filters.category !== null) params.set("category", filters.category);
  if (filters.sort !== "newest") params.set("sort", filters.sort);

  const query = params.toString();
  return query === "" ? "" : `?${query}`;
}

export function hasActiveFilters(filters: Filters): boolean {
  return filters.q.trim() !== "" || filters.category !== null;
}

/** Matches name + description + category + version (PRD §7.1). */
export function applyFilters(tools: SerializedTool[], filters: Filters): SerializedTool[] {
  const needle = filters.q.trim().toLowerCase();

  const matched = tools.filter((tool) => {
    if (filters.category !== null && tool.category !== filters.category) return false;
    if (needle === "") return true;

    return (
      tool.name.toLowerCase().includes(needle) ||
      tool.description.toLowerCase().includes(needle) ||
      tool.category.toLowerCase().includes(needle) ||
      tool.version.toLowerCase().includes(needle)
    );
  });

  return matched.sort(comparators[filters.sort]);
}

const comparators: Record<Sort, (a: SerializedTool, b: SerializedTool) => number> = {
  newest: (a, b) => b.createdAt.localeCompare(a.createdAt),
  name: (a, b) => a.name.localeCompare(b.name),
  // fileSize is a string on the client (BigInt boundary), so compare as BigInt.
  // Number() would lose precision above 2^53 and a string compare would put
  // "300" ahead of "9007199254740993".
  size: (a, b) => (BigInt(b.fileSize) > BigInt(a.fileSize) ? 1 : BigInt(b.fileSize) < BigInt(a.fileSize) ? -1 : 0),
};

function isSort(value: string | null): value is Sort {
  return value !== null && (SORTS as readonly string[]).includes(value);
}

/** Structural match for Next's ReadonlyURLSearchParams without importing it here. */
interface ReadonlyURLSearchParamsLike {
  get(name: string): string | null;
}
