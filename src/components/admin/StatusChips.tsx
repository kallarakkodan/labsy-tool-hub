import { lifecycleStatus } from "@/lib/admin-filters";
import type { SerializedAdminTool } from "@/types";

/*
 * The Status column (PRD §8.2). Up to two chips — see the note in
 * `lib/admin-filters.ts` for why one would hide information here.
 */

const LIFECYCLE: Record<string, { label: string; className: string; title: string }> = {
  published: {
    label: "Published",
    className: "border-border text-fg-muted",
    title: "Visible in the public catalogue",
  },
  draft: {
    label: "Draft",
    className: "border-warning/40 bg-warning/10 text-warning",
    title: "Not published — hidden from everyone but the admin panel",
  },
  missing: {
    label: "Missing",
    className: "border-danger/40 bg-danger/10 text-danger",
    title: "The file is no longer on disk; downloads return 410",
  },
};

export function StatusChips({ tool }: { tool: SerializedAdminTool }) {
  const lifecycle = LIFECYCLE[lifecycleStatus(tool)]!;

  return (
    <span className="flex flex-wrap items-center gap-1.5">
      <Chip label={lifecycle.label} className={lifecycle.className} title={lifecycle.title} />
      {tool.visibility === "admin" && (
        <Chip
          label="Internal"
          className="border-accent/40 text-accent"
          title="Hidden from the public catalogue; visible only while signed in"
        />
      )}
    </span>
  );
}

function Chip({ label, className, title }: { label: string; className: string; title: string }) {
  return (
    <span
      title={title}
      className={`rounded-button border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide ${className}`}
    >
      {label}
    </span>
  );
}
