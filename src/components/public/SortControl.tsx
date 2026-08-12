"use client";

import { ArrowUpDown } from "lucide-react";
import { SORTS, SORT_LABELS, type Sort } from "@/lib/filters";
import { useFilters } from "./use-filters";

/**
 * Newest / Name A–Z / Largest (PRD §7.2).
 *
 * A native `<select>`, deliberately: it is keyboard accessible and correct on
 * touch for free, and the accent budget for this toolbar is already spent on the
 * active category pill (PRD §5.1), so a custom popover would have to be styled
 * neutral anyway.
 */
export function SortControl() {
  const { filters, patch } = useFilters();

  return (
    <div className="relative shrink-0">
      <ArrowUpDown
        className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <select
        value={filters.sort}
        onChange={(event) => patch({ sort: event.target.value as Sort })}
        aria-label="Sort tools"
        className="appearance-none rounded-button border border-border bg-surface py-1.5 pl-8 pr-7 text-xs
                   text-fg-muted transition-colors hover:border-border-hover hover:bg-surface-hover hover:text-fg
                   focus:outline-none focus:ring-2 focus:ring-accent/35"
      >
        {SORTS.map((sort) => (
          <option key={sort} value={sort}>
            {SORT_LABELS[sort]}
          </option>
        ))}
      </select>
      <span
        className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 text-[10px] text-fg-subtle"
        aria-hidden="true"
      >
        ▾
      </span>
    </div>
  );
}
