"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Copy, MoreVertical } from "lucide-react";
import type { SerializedTool } from "@/types";

/*
 * The kebab menu (PRD §7.3), which turns every card into a paste-ready line for
 * a runbook or a headless box — half the consumers are terminals (PRD §13 row 5).
 *
 * Every handler stops propagation: the whole card is an <a download>, and a menu
 * click must never start one.
 */

interface Props {
  tool: SerializedTool;
}

interface Item {
  label: string;
  value: string | null;
}

export function ToolCardMenu({ tool }: Props) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;

    function onPointerDown(event: PointerEvent) {
      if (!container.current?.contains(event.target as Node)) setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // Built lazily: window.location.origin is what makes the snippet pasteable on
  // the machine that will actually run it, rather than whatever the server thinks.
  function items(): Item[] {
    const url = `${window.location.origin}/api/download/${tool.id}`;
    return [
      { label: "Copy download URL", value: url },
      { label: "Copy curl command", value: `curl -fL -O ${url}` },
      { label: "Copy wget command", value: `wget --content-disposition ${url}` },
      { label: "Copy SHA-256", value: tool.checksum },
    ];
  }

  async function copy(item: Item, event: React.MouseEvent) {
    event.preventDefault();
    event.stopPropagation();
    if (item.value === null) return;

    try {
      await navigator.clipboard.writeText(item.value);
      setCopied(item.label);
      setTimeout(() => setCopied(null), 1500);
    } catch {
      setCopied(null);
    }
  }

  return (
    <div ref={container} className="relative">
      <button
        type="button"
        aria-label={`Actions for ${tool.name}`}
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-button p-1 text-fg-subtle transition-colors hover:bg-inset hover:text-fg
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        <MoreVertical className="size-4" aria-hidden="true" />
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 top-8 z-20 w-56 overflow-hidden rounded-card border border-border
                     bg-surface py-1 shadow-overlay"
        >
          {items().map((item) => {
            const disabled = item.value === null;
            return (
              <button
                key={item.label}
                type="button"
                role="menuitem"
                disabled={disabled}
                onClick={(event) => void copy(item, event)}
                className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs
                           text-fg transition-colors hover:bg-surface-hover
                           disabled:cursor-not-allowed disabled:text-fg-subtle disabled:hover:bg-transparent"
              >
                {/* A null checksum means the hash is still running (issue 32). */}
                <span>{disabled ? "SHA-256 — computing…" : item.label}</span>
                {copied === item.label ? (
                  <Check className="size-3.5 shrink-0 text-accent" aria-hidden="true" />
                ) : (
                  !disabled && <Copy className="size-3.5 shrink-0 text-fg-subtle" aria-hidden="true" />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
