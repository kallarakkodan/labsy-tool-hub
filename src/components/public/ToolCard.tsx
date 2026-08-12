import { Download } from "lucide-react";
import { formatBytes, formatDate } from "@/lib/format";
import type { SerializedTool } from "@/types";
import { FileIcon } from "./FileIcon";
import { ToolCardMenu } from "./ToolCardMenu";

/*
 * The tool card (PRD §7.3).
 *
 * The ENTIRE card is an `<a download>`. Not a div with an onClick: middle-click,
 * right-click → Save As, and copy-link all have to behave natively, and PRD §7.3
 * says explicitly not to simulate the click in JavaScript. That is also why the
 * kebab menu stops propagation rather than the card checking what was clicked.
 *
 * A Server Component. Only the menu ships JavaScript.
 */

interface Props {
  tool: SerializedTool;
}

export function ToolCard({ tool }: Props) {
  if (tool.fileMissing) return <UnavailableCard tool={tool} />;

  return (
    <article className="group relative rounded-card border border-border bg-surface transition-all duration-150
                        hover:-translate-y-1 hover:border-border-hover hover:bg-surface-hover
                        motion-reduce:transition-none motion-reduce:hover:translate-y-0
                        focus-within:border-border-hover">
      <a
        href={`/api/download/${tool.id}`}
        download
        className="block rounded-card p-5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        <div className="flex items-start justify-between gap-3 pr-7">
          <div className="flex size-10 shrink-0 items-center justify-center rounded-card bg-accent/10">
            {tool.iconUrl !== null ? (
              // eslint-disable-next-line @next/next/no-img-element -- icons come from arbitrary LAN URLs or /uploads; next/image adds a loader for no gain here
              <img src={tool.iconUrl} alt="" className="size-6 rounded-[4px] object-contain" />
            ) : (
              <FileIcon fileName={tool.fileName} className="size-5 text-accent" />
            )}
          </div>

          <div className="flex items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {tool.category}
            </span>
            <Badges tool={tool} />
            <Download
              className="size-4 text-fg-subtle transition-colors group-hover:text-accent"
              aria-hidden="true"
            />
          </div>
        </div>

        <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">{tool.name}</h2>
        <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{tool.description}</p>

        <div className="mt-4 border-t border-border pt-3">
          <div className="flex items-center justify-between gap-2 font-mono text-xs tabular-nums text-fg-muted">
            <span>
              {formatBytes(tool.fileSize)} · v{tool.version}
            </span>
            <span>Added {formatDate(tool.createdAt)}</span>
          </div>
        </div>
      </a>

      {/* Outside the anchor: nesting a button inside a link is invalid HTML and
          breaks keyboard navigation in ways that are hard to notice. The header
          row above carries pr-7 so the two never overlap. */}
      <div className="absolute right-3 top-4">
        <ToolCardMenu tool={tool} />
      </div>
    </article>
  );
}

/**
 * `fileMissing` renders at 60% opacity with a danger chip and no link at all
 * (PRD §7.3) — a disabled-looking anchor that still navigates is worse than none.
 */
function UnavailableCard({ tool }: { tool: SerializedTool }) {
  return (
    <article className="rounded-card border border-border bg-surface p-5 opacity-60">
      <div className="flex items-start justify-between gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-card bg-inset">
          <FileIcon fileName={tool.fileName} className="size-5 text-fg-subtle" />
        </div>
        <span className="rounded-button border border-danger/40 bg-danger/10 px-2 py-0.5 text-[10px]
                         font-medium uppercase tracking-wider text-danger">
          Unavailable
        </span>
      </div>

      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">{tool.name}</h2>
      <p className="mt-1 line-clamp-2 text-sm text-fg-muted">{tool.description}</p>

      <div className="mt-4 border-t border-border pt-3">
        <p className="font-mono text-xs text-fg-subtle">
          File missing from the server — an administrator has been notified.
        </p>
      </div>
    </article>
  );
}

/** Draft and Internal are admin-only states; anonymous callers never receive them. */
function Badges({ tool }: { tool: SerializedTool }) {
  return (
    <>
      {!tool.published && (
        <span className="rounded-button border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px]
                         font-medium uppercase tracking-wider text-warning">
          Draft
        </span>
      )}
      {tool.visibility === "admin" && (
        <span className="rounded-button border border-accent/40 px-1.5 py-0.5 text-[10px] font-medium
                         uppercase tracking-wider text-accent">
          Internal
        </span>
      )}
    </>
  );
}
