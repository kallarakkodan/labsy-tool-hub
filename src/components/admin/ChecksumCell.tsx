"use client";

import { useState } from "react";
import { Check, Copy, LoaderCircle, RotateCw } from "lucide-react";
import { middleTruncate } from "@/lib/format";

/*
 * The Checksum column (PRD §11.3, issue 32).
 *
 * `checksum === null` means the background job hasn't landed yet — never
 * "there is no checksum" as a permanent state, since every tool eventually
 * gets one (server-path registrations are enqueued on save; uploads already
 * carry theirs in from `lib/admin-tools.ts`'s `resolveFileSource`).
 */
export function ChecksumCell({
  toolId,
  checksum,
  onRecomputed,
}: {
  toolId: string;
  checksum: string | null;
  onRecomputed: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [recomputing, setRecomputing] = useState(false);

  async function copy() {
    if (checksum === null) return;
    try {
      await navigator.clipboard.writeText(checksum);
      setCopied(true);
      setTimeout(() => setCopied(false), 1400);
    } catch {
      // Clipboard needs a secure context; over plain HTTP in dev the write is
      // refused. The title attribute still makes the value selectable by hand.
      setCopied(false);
    }
  }

  async function recompute() {
    setRecomputing(true);
    try {
      await fetch(`/api/admin/tools/${toolId}/checksum`, { method: "POST" });
      onRecomputed();
    } finally {
      setRecomputing(false);
    }
  }

  if (checksum === null) {
    return (
      <span className="flex items-center gap-1.5 font-mono text-xs text-fg-muted">
        <LoaderCircle className="size-3 animate-spin motion-reduce:animate-none" aria-hidden="true" />
        Computing…
      </span>
    );
  }

  return (
    <span className="group/checksum flex items-center gap-1.5">
      <span title={checksum} className="font-mono text-xs text-fg-muted">
        {middleTruncate(checksum, 14)}
      </span>
      <button
        type="button"
        onClick={() => void copy()}
        aria-label={copied ? "Checksum copied" : `Copy checksum ${checksum}`}
        className="rounded-button p-1 text-fg-subtle opacity-0 transition-opacity
                   hover:text-fg focus-visible:opacity-100 focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent/35 group-hover/checksum:opacity-100"
      >
        {copied ? (
          <Check className="size-3 text-accent" aria-hidden="true" />
        ) : (
          <Copy className="size-3" aria-hidden="true" />
        )}
      </button>
      <button
        type="button"
        onClick={() => void recompute()}
        disabled={recomputing}
        aria-label="Recompute checksum"
        title="Recompute checksum"
        className="rounded-button p-1 text-fg-subtle opacity-0 transition-opacity hover:text-fg
                   focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-2
                   focus-visible:ring-accent/35 group-hover/checksum:opacity-100 disabled:cursor-not-allowed"
      >
        <RotateCw
          className={`size-3 ${recomputing ? "animate-spin motion-reduce:animate-none" : ""}`}
          aria-hidden="true"
        />
      </button>
    </span>
  );
}
