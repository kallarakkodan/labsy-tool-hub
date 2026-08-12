"use client";

import { useMemo } from "react";
import { applyFilters } from "@/lib/filters";
import type { CategoryCount } from "@/lib/tools";
import type { SerializedTool } from "@/types";
import { Toolbar } from "./Toolbar";
import { useFilters } from "./use-filters";

/**
 * The client half of the catalogue.
 *
 * The server renders the full in-scope list once; this filters it in memory
 * (CONTEXT §6 — tens of items, not thousands, so there is no server round trip
 * per keystroke). The grid itself lands in issue 16.
 */
interface Props {
  tools: SerializedTool[];
  categories: CategoryCount[];
  total: number;
}

export function Catalogue({ tools, categories, total }: Props) {
  const { filters } = useFilters();
  const visible = useMemo(() => applyFilters(tools, filters), [tools, filters]);

  return (
    <div className="flex flex-col gap-6">
      <Toolbar categories={categories} total={total} resultCount={visible.length} />

      <ul className="flex flex-col gap-2">
        {visible.map((tool) => (
          <li
            key={tool.id}
            className="rounded-card border border-border bg-surface p-4 text-sm text-fg"
          >
            {tool.name}
            <span className="ml-2 font-mono text-xs tabular-nums text-fg-muted">
              {tool.category} · v{tool.version}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
