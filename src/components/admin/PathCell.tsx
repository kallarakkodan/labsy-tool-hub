"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { middleTruncate } from "@/lib/format";

/*
 * The Path column (PRD §8.2).
 *
 * `path` is **relative to STORAGE_ROOT** and that is the whole value — the row
 * is handed a relative path by `serializeAdminTool` and there is no absolute one
 * to reach for. The tooltip shows the same relative path in full, which is worth
 * stating because middle-truncation invites "well, the tooltip could show the
 * real thing": it must not (CONTEXT §2 item 5, and the issue says so twice).
 *
 * The copy button therefore also copies the relative path. That is the useful
 * value anyway: it is what the Server Path field takes, so copying a row's path
 * and pasting it into a new tool's form works.
 */
export function PathCell({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);
  const truncated = middleTruncate(path, 34);

  async function copy() {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard needs a secure context. Over plain HTTP in dev the write is
      // refused; the title attribute still makes the value selectable by hand.
      setCopied(false);
    }
  }

  return (
    <span className="group/path flex items-center gap-1.5">
      <span title={path} className="font-mono text-xs text-fg-muted">
        {truncated}
      </span>
      <button
        type="button"
        onClick={copy}
        aria-label={copied ? "Path copied" : `Copy path ${path}`}
        className="rounded-button p-1 text-fg-subtle opacity-0 transition-opacity
                   hover:text-fg focus-visible:opacity-100 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent/35 group-hover/path:opacity-100"
      >
        {copied ? (
          <Check className="size-3 text-accent" aria-hidden="true" />
        ) : (
          <Copy className="size-3" aria-hidden="true" />
        )}
      </button>
    </span>
  );
}
