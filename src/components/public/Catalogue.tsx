"use client";

import { useMemo } from "react";
import { applyFilters } from "@/lib/filters";
import type { CategoryCount } from "@/lib/tools";
import type { SerializedTool } from "@/types";
import { ToolCard } from "./ToolCard";
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

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {visible.map((tool) => (
          <ToolCard key={tool.id} tool={tool} />
        ))}
      </div>
    </div>
  );
}
