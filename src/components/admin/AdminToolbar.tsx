"use client";

import { Search } from "lucide-react";
import { STALE_AFTER_DAYS, type AdminFilters } from "@/lib/admin-filters";
import type { CategoryCount } from "@/lib/tools";

/*
 * Search, category, and the Stale toggle (PRD §8.2), mirroring the public
 * toolbar's shape so the two screens do not feel like different products.
 *
 * State is lifted rather than URL-synced. The public toolbar writes to the URL
 * because engineers paste filtered catalogue links at each other (PRD §13 row 9);
 * nobody pastes a link to a filtered admin table, and a `?stale=true` in the
 * address bar of a page that is about to grow a slide-over is state to
 * reconcile for no gain.
 */

interface Props {
  filters: AdminFilters;
  onChange: (next: AdminFilters) => void;
  categories: CategoryCount[];
  shown: number;
  total: number;
}

export function AdminToolbar({ filters, onChange, categories, shown, total }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
      <div className="relative w-full sm:max-w-[320px]">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          type="search"
          value={filters.q}
          onChange={(event) => onChange({ ...filters, q: event.target.value })}
          placeholder="Search name, path, version"
          aria-label="Search tools"
          className="w-full rounded-card border border-border bg-inset py-2 pl-9 pr-3 text-sm text-fg
                     placeholder:text-fg-subtle focus:border-border-hover focus:outline-none
                     focus:ring-2 focus:ring-accent/35 [&::-webkit-search-cancel-button]:appearance-none"
        />
      </div>

      <label className="sr-only" htmlFor="admin-category">
        Filter by category
      </label>
      <select
        id="admin-category"
        value={filters.category ?? ""}
        onChange={(event) =>
          onChange({ ...filters, category: event.target.value === "" ? null : event.target.value })
        }
        className="rounded-card border border-border bg-inset px-3 py-2 text-sm text-fg
                   focus:border-border-hover focus:outline-none focus:ring-2 focus:ring-accent/35"
      >
        <option value="">All categories</option>
        {categories.map((category) => (
          <option key={category.name} value={category.name}>
            {category.name} ({category.count})
          </option>
        ))}
      </select>

      <button
        type="button"
        role="switch"
        aria-checked={filters.stale}
        onClick={() => onChange({ ...filters, stale: !filters.stale })}
        title={`Never downloaded, or idle for more than ${STALE_AFTER_DAYS} days`}
        className={`rounded-button border px-3 py-2 text-xs font-medium transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35 ${
                      filters.stale
                        ? "border-warning/40 bg-warning/10 text-warning"
                        : "border-border bg-surface text-fg-muted hover:border-border-hover hover:bg-surface-hover"
                    }`}
      >
        Stale only
      </button>

      <p className="font-mono text-xs text-fg-muted tabular-nums sm:ml-auto">
        {shown === total ? `${total} tools` : `${shown} of ${total}`}
      </p>
    </div>
  );
}
