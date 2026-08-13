"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown, Copy, Pencil, Trash2 } from "lucide-react";
import {
  createColumnHelper,
  createSortedRowModel,
  rowSortingFeature,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { formatBytes, formatDate, formatRelativeDate } from "@/lib/format";
import type { SerializedAdminTool } from "@/types";
import { ChecksumCell } from "./ChecksumCell";
import { PathCell } from "./PathCell";
import { StatusChips } from "./StatusChips";

/*
 * The dashboard table (PRD §8.2), on TanStack Table v9 — headless, so every
 * pixel here is the token set rather than a vendor theme.
 *
 * **v9, not v8.** The API most references describe (`useReactTable`,
 * `getCoreRowModel()` as an option) is v8 and does not exist here: v9 uses
 * `useTable`, and features are registered explicitly through `tableFeatures`,
 * with row models as slots inside it. State a feature owns does not exist until
 * the feature is registered — a missing `sorting` is a missing import, not a
 * typing problem. Sorting is the only feature this table needs; search,
 * category, and Stale are applied upstream in `lib/admin-filters.ts` over an
 * already-hydrated list, which is the same shape the public catalogue uses.
 *
 * `features` and `columns` live at module scope: a new reference on each render
 * invalidates the row models every time.
 */

const features = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
});

const helper = createColumnHelper<typeof features, SerializedAdminTool>();

export interface RowActions {
  onEdit: (tool: SerializedAdminTool) => void;
  onDelete: (tool: SerializedAdminTool) => void;
  onDuplicate: (tool: SerializedAdminTool) => void;
  /** Id of a row with a duplicate in flight. */
  busyId: string | null;
}

export interface TableMeta extends RowActions {
  /**
   * One instant for the whole render, from the Server Component.
   *
   * `formatRelativeDate` defaults to reading the clock, which makes a
   * server-rendered "23 seconds ago" hydrate as "24 seconds ago" — a mismatch
   * React reports as an error and recovers from by throwing away the tree. One
   * pinned instant makes both sides agree; going stale until the next refresh
   * is the right trade on a dashboard.
   */
  nowMs: number;
  /** Re-fetches the list — the Checksum column's Recompute button uses this to pick up the "Computing…" state. */
  refresh: () => void;
}

const columns = helper.columns([
  helper.accessor("name", {
    header: "Name",
    cell: ({ row }) => (
      <div className="min-w-0">
        <div className="truncate text-sm font-medium text-fg">{row.original.name}</div>
        <div className="truncate font-mono text-xs text-fg-muted">{row.original.fileName}</div>
      </div>
    ),
  }),

  helper.accessor("category", {
    header: "Category",
    cell: ({ getValue }) => (
      <span className="rounded-button border border-border px-2 py-0.5 text-xs text-fg-muted">
        {getValue()}
      </span>
    ),
  }),

  helper.accessor("fileSize", {
    header: "Size",
    /*
     * `fileSize` crosses the wire as a decimal string (the BigInt boundary), so
     * the default comparator would sort it lexicographically and put "9 B" above
     * "10 GB". Comparing as BigInt rather than coercing to Number also keeps
     * sizes above 2^53 bytes ordered correctly — the same reason `lib/filters.ts`
     * does it this way for the public grid.
     */
    sortFn: (a, b) => {
      const left = BigInt(a.original.fileSize);
      const right = BigInt(b.original.fileSize);
      return left < right ? -1 : left > right ? 1 : 0;
    },
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-fg tabular-nums">{formatBytes(getValue())}</span>
    ),
  }),

  helper.accessor("version", {
    header: "Version",
    cell: ({ getValue }) => <span className="font-mono text-xs text-fg-muted">{getValue()}</span>,
  }),

  helper.accessor("filePath", {
    header: "Path",
    cell: ({ getValue }) => <PathCell path={getValue()} />,
  }),

  helper.accessor("checksum", {
    header: "Checksum",
    cell: ({ row, table }) => (
      <ChecksumCell
        toolId={row.original.id}
        checksum={row.original.checksum}
        onRecomputed={(table.options.meta as TableMeta).refresh}
      />
    ),
  }),

  helper.display({
    id: "status",
    header: "Status",
    cell: ({ row }) => <StatusChips tool={row.original} />,
  }),

  helper.accessor("downloadCount", {
    header: "Downloads",
    cell: ({ row, table }) => (
      <span
        className="font-mono text-xs text-fg tabular-nums"
        title={`Last downloaded ${formatRelativeDate(
          row.original.lastDownloadAt,
          new Date((table.options.meta as TableMeta).nowMs),
        )}`}
      >
        {row.original.downloadCount}
      </span>
    ),
  }),

  helper.accessor("updatedAt", {
    header: "Updated",
    cell: ({ getValue, table }) => (
      <span className="whitespace-nowrap text-xs text-fg-muted" title={formatDate(getValue())}>
        {formatRelativeDate(getValue(), new Date((table.options.meta as TableMeta).nowMs))}
      </span>
    ),
  }),

  helper.display({
    id: "actions",
    header: () => <span className="sr-only">Actions</span>,
    cell: ({ row, table }) => {
      const actions = table.options.meta as TableMeta;
      const tool = row.original;
      const busy = actions.busyId === tool.id;

      return (
        <div className="flex items-center justify-end gap-0.5">
          <IconButton label={`Edit ${tool.name}`} onClick={() => actions.onEdit(tool)}>
            <Pencil className="size-3.5" aria-hidden="true" />
          </IconButton>

          <IconButton
            label={`Duplicate ${tool.name} as a draft`}
            onClick={busy ? undefined : () => actions.onDuplicate(tool)}
          >
            <Copy className="size-3.5" aria-hidden="true" />
          </IconButton>

          <IconButton label={`Delete ${tool.name}`} danger onClick={() => actions.onDelete(tool)}>
            <Trash2 className="size-3.5" aria-hidden="true" />
          </IconButton>
        </div>
      );
    },
  }),
]);

function IconButton({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string;
  /** Undefined while busy (the Duplicate action) — the row's other actions stay live. */
  onClick?: () => void;
  danger?: boolean;
  children: React.ReactNode;
}) {
  const disabled = onClick === undefined;

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={label}
      title={label}
      className={`rounded-button p-1.5 transition-colors focus-visible:outline-none
                  focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed
                  disabled:opacity-35 ${
                    danger
                      ? "text-fg-subtle hover:not-disabled:bg-danger/10 hover:not-disabled:text-danger"
                      : "text-fg-subtle hover:not-disabled:bg-surface-hover hover:not-disabled:text-fg"
                  }`}
    >
      {children}
    </button>
  );
}

/** The one right-aligned column (PRD §8.2). A set, so adding a second is one edit. */
const RIGHT_ALIGNED = new Set(["fileSize"]);

function alignRight(columnId: string): boolean {
  return RIGHT_ALIGNED.has(columnId);
}

const SORT_ICON = {
  asc: ArrowUp,
  desc: ArrowDown,
} as const;

export function ToolsTable({ tools, meta }: { tools: SerializedAdminTool[]; meta: TableMeta }) {
  const table = useTable({ features, columns, data: tools, meta });

  return (
    <div className="overflow-x-auto rounded-card border border-border bg-surface">
      <table className="w-full min-w-[980px] border-collapse text-left">
        <thead>
          {table.getHeaderGroups().map((group) => (
            <tr key={group.id} className="border-b border-border">
              {group.headers.map((header) => {
                const sortable = header.column.getCanSort();
                const direction = header.column.getIsSorted();
                const Icon = direction === false ? ChevronsUpDown : SORT_ICON[direction];

                return (
                  <th
                    key={header.id}
                    scope="col"
                    aria-sort={
                      direction === false ? "none" : direction === "asc" ? "ascending" : "descending"
                    }
                    className={`px-3 py-2.5 text-xs font-medium text-fg-subtle ${
                      alignRight(header.column.id) ? "text-right" : ""
                    }`}
                  >
                    {header.isPlaceholder ? null : sortable ? (
                      <button
                        type="button"
                        onClick={header.column.getToggleSortingHandler()}
                        className="flex items-center gap-1 rounded-button transition-colors hover:text-fg
                                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
                      >
                        <table.FlexRender header={header} />
                        <Icon
                          className={`size-3 ${direction === false ? "opacity-40" : "text-accent"}`}
                          aria-hidden="true"
                        />
                      </button>
                    ) : (
                      <table.FlexRender header={header} />
                    )}
                  </th>
                );
              })}
            </tr>
          ))}
        </thead>

        <tbody>
          {table.getRowModel().rows.map((row) => (
            <tr
              key={row.id}
              className="border-b border-border/60 transition-colors last:border-0 hover:bg-surface-hover"
            >
              {row.getAllCells().map((cell) => (
                <td
                  key={cell.id}
                  className={`px-3 py-2.5 align-middle ${
                    alignRight(cell.column.id) ? "text-right" : ""
                  }`}
                >
                  <table.FlexRender cell={cell} />
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
