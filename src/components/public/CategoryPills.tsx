"use client";

import type { CategoryCount } from "@/lib/tools";
import { useFilters } from "./use-filters";

/*
 * Horizontally scrollable category pills (PRD §7.2).
 *
 * `All` is always first and carries the total. Exactly one pill is accent-filled
 * at a time, which is the whole accent budget for this toolbar (PRD §5.1) — the
 * sort control beside it stays neutral on purpose.
 */

interface Props {
  categories: CategoryCount[];
  total: number;
}

const BASE =
  "shrink-0 rounded-button border px-3 py-1.5 text-xs font-medium transition-colors " +
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35";

const ACTIVE = "border-accent/40 bg-accent/10 text-accent";
const INACTIVE = "border-border bg-surface text-fg-muted hover:border-border-hover hover:bg-surface-hover hover:text-fg";

export function CategoryPills({ categories, total }: Props) {
  const { filters, patch } = useFilters();

  return (
    <div
      className="flex gap-2 overflow-x-auto pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      role="group"
      aria-label="Filter by category"
    >
      <button
        type="button"
        onClick={() => patch({ category: null })}
        aria-pressed={filters.category === null}
        className={`${BASE} ${filters.category === null ? ACTIVE : INACTIVE}`}
      >
        All <span className="font-mono tabular-nums opacity-70">{total}</span>
      </button>

      {categories.map((category) => {
        const active = filters.category === category.name;
        return (
          <button
            key={category.name}
            type="button"
            onClick={() => patch({ category: active ? null : category.name })}
            aria-pressed={active}
            className={`${BASE} ${active ? ACTIVE : INACTIVE}`}
          >
            {category.name} <span className="font-mono tabular-nums opacity-70">{category.count}</span>
          </button>
        );
      })}
    </div>
  );
}
