"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { PackageOpen, Plus, SearchX } from "lucide-react";
import {
  EMPTY_ADMIN_FILTERS,
  STALE_AFTER_DAYS,
  applyAdminFilters,
  hasActiveAdminFilters,
  type AdminFilters,
} from "@/lib/admin-filters";
import type { CategoryCount } from "@/lib/tools";
import type { SerializedAdminTool } from "@/types";
import { AdminToolbar } from "./AdminToolbar";
import { ToolFormSlideOver } from "./ToolFormSlideOver";
import { ToolsTable } from "./ToolsTable";

/*
 * The client half of `/admin` (PRD §8.2).
 *
 * Same division as the public catalogue: the Server Component runs the query
 * and hands over the whole list, this filters it in memory. Tens of rows, so a
 * server round trip per keystroke would be the wrong trade (CONTEXT §6) — and
 * it keeps one implementation of the admin scoping, in `listAdminTools`.
 */

interface Props {
  tools: SerializedAdminTool[];
  categories: CategoryCount[];
  /** One render instant from the server — see `TableMeta.nowMs`. */
  nowMs: number;
}

type FormTarget = { mode: "create" } | { mode: "edit"; tool: SerializedAdminTool };

export function Dashboard({ tools, categories, nowMs }: Props) {
  const router = useRouter();
  const [filters, setFilters] = useState<AdminFilters>(EMPTY_ADMIN_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [formTarget, setFormTarget] = useState<FormTarget | null>(null);

  const visible = useMemo(
    () => applyAdminFilters(tools, filters, new Date(nowMs)),
    [tools, filters, nowMs],
  );

  // Every other tool's slug, lowercased — the slide-over's on-blur uniqueness
  // check runs against this rather than a network round trip (CONTEXT §6: tens
  // of rows, not thousands).
  const existingSlugs = useMemo(() => {
    const editingId = formTarget?.mode === "edit" ? formTarget.tool.id : null;
    return new Set(tools.filter((t) => t.id !== editingId).map((t) => t.slug.toLowerCase()));
  }, [tools, formTarget]);

  /**
   * Duplicate as a draft (PRD §8.2's `Copy` action).
   *
   * A plain `POST /api/admin/tools` with the same server path and no slug: the
   * create route derives a fresh unique one by suffixing (issue 22), which is
   * exactly the behaviour a duplicate wants. `published: false` is the point of
   * the action — a copy is a starting point for an edit, not a second live
   * listing, and shipping one to the public catalogue by accident would be a
   * surprise.
   */
  async function duplicate(tool: SerializedAdminTool) {
    setBusyId(tool.id);
    setError(null);

    try {
      const response = await fetch("/api/admin/tools", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: `${tool.name} (copy)`,
          description: tool.description,
          category: tool.category,
          version: tool.version,
          iconUrl: tool.iconUrl,
          notes: tool.notes,
          published: false,
          visibility: tool.visibility,
          file: { source: "serverPath", relativePath: tool.filePath },
        }),
      });

      if (!response.ok) {
        const body: { error?: { message?: string } } = await response.json().catch(() => ({}));
        setError(body.error?.message ?? "The duplicate could not be created.");
        return;
      }

      // The list is server-rendered, so a refresh is what makes the new row appear.
      router.refresh();
    } catch {
      setError("The hub could not be reached. Check the connection and retry.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-center justify-between gap-4">
        <h1 className="text-lg font-semibold text-fg">
          Tools <span className="font-mono text-sm text-fg-muted tabular-nums">{tools.length}</span>
        </h1>

        <button
          type="button"
          onClick={() => setFormTarget({ mode: "create" })}
          className="flex items-center gap-1.5 rounded-button bg-accent px-4 py-2 text-sm font-medium
                     text-base transition-colors hover:bg-accent-hover focus-visible:outline-none
                     focus-visible:ring-2 focus-visible:ring-accent/35"
        >
          <Plus className="size-4" aria-hidden="true" />
          Add New Tool
        </button>
      </div>

      {tools.length > 0 && (
        <AdminToolbar
          filters={filters}
          onChange={setFilters}
          categories={categories}
          shown={visible.length}
          total={tools.length}
        />
      )}

      {error !== null && (
        <div role="alert" className="rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
          <p className="text-sm text-danger">{error}</p>
        </div>
      )}

      {tools.length === 0 ? (
        <EmptyCatalogue />
      ) : visible.length === 0 ? (
        <NoMatches filters={filters} onClear={() => setFilters(EMPTY_ADMIN_FILTERS)} />
      ) : (
        <ToolsTable
          tools={visible}
          meta={{
            onEdit: (tool) => setFormTarget({ mode: "edit", tool }),
            onDuplicate: duplicate,
            busyId,
            nowMs,
          }}
        />
      )}

      {formTarget !== null && (
        <ToolFormSlideOver
          key={formTarget.mode === "edit" ? formTarget.tool.id : "create"}
          mode={formTarget.mode}
          tool={formTarget.mode === "edit" ? formTarget.tool : undefined}
          categories={categories}
          existingSlugs={existingSlugs}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            router.refresh();
          }}
        />
      )}
    </div>
  );
}

function EmptyCatalogue() {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
      <PackageOpen className="size-8 text-fg-subtle" aria-hidden="true" />
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">No tools yet.</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        Add your first tool from the admin panel, or point the hub at a file already on the server.
      </p>
    </div>
  );
}

function NoMatches({ filters, onClear }: { filters: AdminFilters; onClear: () => void }) {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
      <SearchX className="size-8 text-fg-subtle" aria-hidden="true" />
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">
        {filters.stale && !hasOtherFilters(filters)
          ? `Nothing has been idle for ${STALE_AFTER_DAYS} days.`
          : "No tools match those filters."}
      </h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        {filters.stale && !hasOtherFilters(filters)
          ? "Every tool in the catalogue has been downloaded recently. There is nothing to review."
          : "Check the spelling, or widen the filter."}
      </p>
      {hasActiveAdminFilters(filters) && (
        <button
          type="button"
          onClick={onClear}
          className="mt-5 rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                     transition-colors hover:border-border-hover hover:bg-surface-hover
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        >
          Clear filters
        </button>
      )}
    </div>
  );
}

function hasOtherFilters(filters: AdminFilters): boolean {
  return filters.q.trim() !== "" || filters.category !== null;
}
