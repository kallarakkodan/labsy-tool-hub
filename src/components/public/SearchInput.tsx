"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Search } from "lucide-react";
import { useFilters } from "./use-filters";

/** PRD §7.1: debounced 120ms, so the URL write lands inside §14's 150ms budget. */
const DEBOUNCE_MS = 120;

/**
 * Platform read through `useSyncExternalStore` rather than state-in-an-effect.
 * The server snapshot is `null`, so the hint renders nothing during SSR and
 * cannot mismatch on hydration — and there is no cascading render to reconcile.
 */
const NEVER_CHANGES = () => () => {};
const readIsMac = () => /Mac|iPhone|iPad/.test(navigator.userAgent);
const serverIsMac = () => null;

export function SearchInput() {
  const { filters, patch } = useFilters();
  const inputRef = useRef<HTMLInputElement>(null);
  const isMac = useSyncExternalStore(NEVER_CHANGES, readIsMac, serverIsMac);

  /*
   * The field owns its value so typing is instant; the URL catches up 120ms
   * later. When the URL changes from somewhere else — a Back, or the empty
   * state's "clear filters" — the field has to follow.
   *
   * That reconciliation happens during render, comparing against the last query
   * we saw, rather than in an effect. It is React's documented way to adjust
   * state when an input changes, and it avoids the cascading re-render an
   * effect would cause on every keystroke.
   */
  const [value, setValue] = useState(filters.q);
  const [lastQuery, setLastQuery] = useState(filters.q);
  if (filters.q !== lastQuery) {
    setLastQuery(filters.q);
    setValue(filters.q);
  }

  // Debounce the URL write, not the keystroke.
  useEffect(() => {
    if (value === filters.q) return;
    const timer = setTimeout(() => patch({ q: value }), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [value, filters.q, patch]);

  /*
   * ⌘K focuses the field. The command palette is P6 (PRD §13 row 13); shipping
   * the hint with nothing behind it would be worse than not showing it, so the
   * shortcut does the useful half now and upgrades later.
   */
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key.toLowerCase() === "k" && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
      if (event.key === "Escape" && document.activeElement === inputRef.current) {
        inputRef.current?.blur();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  return (
    <div className="relative w-full max-w-[480px]">
      <Search
        className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />
      <input
        ref={inputRef}
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search tools"
        aria-label="Search tools by name, description, category, or version"
        className="w-full rounded-card border border-border bg-inset py-2 pl-9 pr-16 text-sm text-fg
                   placeholder:text-fg-subtle focus:border-border-hover focus:outline-none
                   focus:ring-2 focus:ring-accent/35 [&::-webkit-search-cancel-button]:appearance-none"
      />
      {isMac !== null && value === "" && (
        <kbd
          className="pointer-events-none absolute right-3 top-1/2 hidden -translate-y-1/2 select-none
                     rounded-button border border-border px-1.5 py-0.5 font-mono text-[10px]
                     text-fg-subtle sm:block"
          aria-hidden="true"
        >
          {isMac ? "⌘" : "Ctrl "}K
        </kbd>
      )}
    </div>
  );
}
