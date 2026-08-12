"use client";

import type { CategoryCount } from "@/lib/tools";
import { CategoryPills } from "./CategoryPills";
import { SortControl } from "./SortControl";

/**
 * The filter row (PRD §7.2): scrollable category pills on the left, sort control
 * and result count right-aligned.
 *
 * `resultCount` is the count *after* filtering, while the pill badges show what
 * is available to pick. Those are different questions and the numbers should
 * disagree when a filter is on.
 */
interface Props {
  categories: CategoryCount[];
  total: number;
  resultCount: number;
}

export function Toolbar({ categories, total, resultCount }: Props) {
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <CategoryPills categories={categories} total={total} />

      <div className="flex shrink-0 items-center gap-3">
        <span className="font-mono text-xs tabular-nums text-fg-muted" aria-live="polite">
          {resultCount} {resultCount === 1 ? "tool" : "tools"}
        </span>
        <SortControl />
      </div>
    </div>
  );
}
