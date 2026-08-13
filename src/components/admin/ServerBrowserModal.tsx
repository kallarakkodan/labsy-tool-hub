"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  Folder,
  HardDrive,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { formatBytes, formatDate } from "@/lib/format";
import type { BrowseEntry, BrowseListing } from "@/types";
import { FileIcon } from "../public/FileIcon";

/*
 * The server file browser modal (PRD §8.4, issue 27).
 *
 * Entirely a client of `GET /api/browse` (issue 26) — nothing here touches
 * `fs` or reasons about the storage root itself. Every path this component
 * holds or emits is relative to the root; the breadcrumb is rooted at a
 * `storage` label, never the host path (PRD §8.4's "watch out").
 */

export interface BrowseSelection {
  relativePath: string;
  fileName: string;
  /** Bytes, as a decimal string. */
  size: string;
  mtime: string;
}

interface Props {
  onClose: () => void;
  onSelect: (file: BrowseSelection) => void;
}

type LoadState = "loading" | "ready" | "error";

export function ServerBrowserModal({ onClose, onSelect }: Props) {
  const [entered, setEntered] = useState(false);
  const [currentPath, setCurrentPath] = useState("");
  const [showHidden, setShowHidden] = useState(false);
  const [listing, setListing] = useState<BrowseListing | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [selectedName, setSelectedName] = useState<string | null>(null);
  const [focusedIndex, setFocusedIndex] = useState<number | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const frame = requestAnimationFrame(() => setEntered(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  useEffect(() => {
    function handleKey(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    document.addEventListener("keydown", handleKey);
    return () => document.removeEventListener("keydown", handleKey);
  }, [onClose]);

  useEffect(() => {
    load(currentPath, showHidden);
  }, [currentPath, showHidden]);

  /** The only way `currentPath` should change — keeps the per-directory UI state in sync with it. */
  function navigate(path: string) {
    setCurrentPath(path);
    setSelectedName(null);
    setFocusedIndex(null);
    setFilter("");
  }

  async function load(path: string, hidden: boolean) {
    const id = requestId.current + 1;
    requestId.current = id;

    setLoadState("loading");
    setErrorMessage(null);

    try {
      const response = await fetch(
        `/api/browse?path=${encodeURIComponent(path)}&showHidden=${hidden}`,
      );
      if (requestId.current !== id) return; // a newer navigation has already superseded this one

      if (!response.ok) {
        const body: { error?: { message?: string } } = await response.json().catch(() => ({}));
        setErrorMessage(body.error?.message ?? "That folder could not be loaded.");
        setLoadState("error");
        return;
      }

      setListing(await response.json());
      setLoadState("ready");
    } catch {
      if (requestId.current !== id) return;
      setErrorMessage("The hub could not be reached. Check the connection and retry.");
      setLoadState("error");
    }
  }

  const visibleEntries = useMemo(() => {
    if (listing === null) return [];
    const q = filter.trim().toLowerCase();
    if (q === "") return listing.entries;
    return listing.entries.filter((e) => e.name.toLowerCase().includes(q));
  }, [listing, filter]);

  const segments = currentPath === "" ? [] : currentPath.split("/");
  const selectedEntry = listing?.entries.find((e) => e.name === selectedName) ?? null;

  function descend(name: string) {
    navigate(currentPath === "" ? name : `${currentPath}/${name}`);
  }

  function activate(entry: BrowseEntry, confirm: boolean) {
    if (entry.type === "dir") {
      descend(entry.name);
      return;
    }
    setSelectedName(entry.name);
    if (confirm) confirmEntry(entry);
  }

  function confirmEntry(entry: BrowseEntry) {
    onSelect({
      relativePath: currentPath === "" ? entry.name : `${currentPath}/${entry.name}`,
      fileName: entry.name,
      size: entry.size ?? "0",
      mtime: entry.mtime,
    });
  }

  function handleListKeyDown(event: React.KeyboardEvent) {
    if (visibleEntries.length === 0) return;

    if (event.key === "ArrowDown") {
      event.preventDefault();
      setFocusedIndex((i) => (i === null ? 0 : Math.min(i + 1, visibleEntries.length - 1)));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setFocusedIndex((i) => (i === null ? 0 : Math.max(i - 1, 0)));
    } else if (event.key === "Enter" && focusedIndex !== null) {
      event.preventDefault();
      const entry = visibleEntries[focusedIndex];
      if (entry !== undefined) activate(entry, true);
    }
  }

  return (
    <div
      className="fixed inset-0 z-40 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="browse-modal-heading"
    >
      <div
        onClick={onClose}
        className={`absolute inset-0 bg-base/70 transition-opacity duration-200 ${
          entered ? "opacity-100" : "opacity-0"
        }`}
      />

      <div
        className={`relative flex max-h-[80vh] w-full max-w-[640px] flex-col rounded-card border
                    border-border bg-surface shadow-overlay transition-all duration-200 ease-out-quart
                    motion-reduce:transition-none ${
                      entered ? "scale-100 opacity-100" : "scale-95 opacity-0"
                    }`}
      >
        <div className="flex items-center justify-between gap-4 border-b border-border px-5 py-4">
          <h2 id="browse-modal-heading" className="text-[15px] font-semibold text-fg">
            Browse Server
          </h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-button p-1.5 text-fg-subtle transition-colors hover:bg-surface-hover
                       hover:text-fg focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/35"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3">
          <Breadcrumb segments={segments} onNavigate={navigate} />

          <div className="ml-auto flex items-center gap-1">
            <IconButton
              label="Up one level"
              disabled={currentPath === ""}
              onClick={() => navigate(parentOf(currentPath))}
            >
              <ArrowUp className="size-4" aria-hidden="true" />
            </IconButton>
            <IconButton
              label={showHidden ? "Hide hidden files" : "Show hidden files"}
              onClick={() => setShowHidden((v) => !v)}
              active={showHidden}
            >
              {showHidden ? (
                <Eye className="size-4" aria-hidden="true" />
              ) : (
                <EyeOff className="size-4" aria-hidden="true" />
              )}
            </IconButton>
            <IconButton label="Refresh" onClick={() => load(currentPath, showHidden)}>
              <RefreshCw className="size-4" aria-hidden="true" />
            </IconButton>
          </div>
        </div>

        <div className="border-b border-border px-5 py-2.5">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-fg-subtle"
              aria-hidden="true"
            />
            <input
              value={filter}
              onChange={(event) => {
                setFilter(event.target.value);
                setFocusedIndex(null);
              }}
              placeholder="Filter this folder"
              aria-label="Filter this folder"
              className="w-full rounded-card border border-border bg-inset py-1.5 pl-8 pr-3 text-sm text-fg
                         placeholder:text-fg-subtle focus:border-border-hover focus:outline-none
                         focus:ring-2 focus:ring-accent/35"
            />
          </div>
        </div>

        <div
          role="listbox"
          aria-label="Folder contents"
          tabIndex={0}
          onKeyDown={handleListKeyDown}
          className="flex-1 overflow-y-auto px-2 py-2 focus:outline-none"
        >
          {loadState === "loading" ? (
            <RowSkeleton />
          ) : loadState === "error" ? (
            <div className="mx-3 my-2 rounded-card border border-danger/40 bg-danger/10 px-4 py-3">
              <p className="text-sm text-danger">{errorMessage}</p>
            </div>
          ) : visibleEntries.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-fg-muted">
              {listing?.entries.length === 0
                ? "This folder is empty."
                : `No entries match "${filter.trim()}".`}
            </p>
          ) : (
            visibleEntries.map((entry, index) => (
              <Row
                key={entry.name}
                entry={entry}
                selected={entry.name === selectedName}
                focused={index === focusedIndex}
                onClick={() => {
                  setFocusedIndex(index);
                  activate(entry, false);
                }}
                onDoubleClick={() => activate(entry, true)}
              />
            ))
          )}
          {listing?.truncated === true && (
            <p className="px-3 py-2 text-xs text-fg-muted">
              Showing the first 5,000 entries.
            </p>
          )}
        </div>

        <div className="flex items-center justify-between gap-4 border-t border-border px-5 py-4">
          <div className="min-w-0 text-sm">
            {selectedEntry !== null ? (
              <>
                <span className="truncate font-mono text-fg">{selectedEntry.name}</span>
                <span className="ml-2 font-mono text-xs text-fg-muted tabular-nums">
                  {formatBytes(selectedEntry.size ?? "0")}
                </span>
              </>
            ) : (
              <span className="text-fg-subtle">No file selected</span>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                         transition-colors hover:border-border-hover hover:bg-surface-hover
                         focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={selectedEntry === null}
              onClick={() => selectedEntry !== null && confirmEntry(selectedEntry)}
              className="rounded-button bg-accent px-4 py-2 text-sm font-medium text-base
                         transition-colors hover:bg-accent-hover focus-visible:outline-none
                         focus-visible:ring-2 focus-visible:ring-accent/35 disabled:cursor-not-allowed
                         disabled:opacity-50"
            >
              Select File
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function parentOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

function Breadcrumb({
  segments,
  onNavigate,
}: {
  segments: string[];
  onNavigate: (path: string) => void;
}) {
  return (
    <div className="flex min-w-0 items-center gap-1 overflow-x-auto font-mono text-xs">
      <button
        type="button"
        onClick={() => onNavigate("")}
        className="flex shrink-0 items-center gap-1 rounded-button px-1.5 py-1 text-fg-muted
                   transition-colors hover:bg-surface-hover hover:text-fg focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        <HardDrive className="size-3.5" aria-hidden="true" />
        storage
      </button>
      {segments.map((segment, index) => (
        <span key={index} className="flex shrink-0 items-center gap-1">
          <ChevronRight className="size-3 text-fg-subtle" aria-hidden="true" />
          <button
            type="button"
            onClick={() => onNavigate(segments.slice(0, index + 1).join("/"))}
            className="rounded-button px-1.5 py-1 text-fg-muted transition-colors hover:bg-surface-hover
                       hover:text-fg focus-visible:outline-none focus-visible:ring-2
                       focus-visible:ring-accent/35"
          >
            {segment}
          </button>
        </span>
      ))}
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled = false,
  active = false,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
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
                    active
                      ? "bg-accent/10 text-accent"
                      : "text-fg-subtle hover:not-disabled:bg-surface-hover hover:not-disabled:text-fg"
                  }`}
    >
      {children}
    </button>
  );
}

function Row({
  entry,
  selected,
  focused,
  onClick,
  onDoubleClick,
}: {
  entry: BrowseEntry;
  selected: boolean;
  focused: boolean;
  onClick: () => void;
  onDoubleClick: () => void;
}) {
  return (
    <div
      role="option"
      aria-selected={selected}
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className={`flex cursor-pointer items-center gap-3 rounded-card border px-3 py-2 text-sm
                  transition-colors ${
                    selected
                      ? "border-accent/50 bg-accent/10"
                      : focused
                        ? "border-border-hover bg-surface-hover"
                        : "border-transparent hover:bg-surface-hover"
                  }`}
    >
      {entry.type === "dir" ? (
        <Folder className="size-4 shrink-0 text-fg-muted" aria-hidden="true" />
      ) : (
        <FileIcon fileName={entry.name} className="size-4 shrink-0 text-fg-muted" />
      )}
      <span className="min-w-0 flex-1 truncate font-mono text-fg">{entry.name}</span>
      {entry.type === "file" && (
        <span className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
          {formatBytes(entry.size ?? "0")}
        </span>
      )}
      <span className="shrink-0 whitespace-nowrap text-xs text-fg-muted">{formatDate(entry.mtime)}</span>
    </div>
  );
}

function RowSkeleton() {
  return (
    <div className="flex flex-col gap-1" aria-hidden="true">
      {Array.from({ length: 8 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 rounded-card px-3 py-2">
          <div className="size-4 shrink-0 rounded-button bg-inset" />
          <div className="h-3 flex-1 rounded-button bg-inset" style={{ maxWidth: `${40 + (i % 4) * 15}%` }} />
          <div className="h-3 w-12 shrink-0 rounded-button bg-inset" />
          <div className="h-3 w-16 shrink-0 rounded-button bg-inset" />
        </div>
      ))}
    </div>
  );
}
