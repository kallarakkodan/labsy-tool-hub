"use client";

import { useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import type { CategoryCount } from "@/lib/tools";

/*
 * The Category field (PRD §8.3): pick an existing category or type a new one.
 *
 * A plain text input that reveals a filtered dropdown on focus, not a native
 * <select> — typing a category the catalogue has never seen is the common
 * path (the first "Firmware" entry has to come from somewhere), and <select>
 * has no way to accept free text.
 */

interface Props {
  id: string;
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  categories: CategoryCount[];
}

export function CategoryCombobox({ id, value, onChange, onBlur, categories }: Props) {
  const [open, setOpen] = useState(false);
  const [highlighted, setHighlighted] = useState(0);
  const listId = useId();
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const matches = useMemo(() => {
    const q = value.trim().toLowerCase();
    const filtered = q === "" ? categories : categories.filter((c) => c.name.toLowerCase().includes(q));
    return filtered.slice(0, 8);
  }, [categories, value]);

  const exact = categories.some((c) => c.name.toLowerCase() === value.trim().toLowerCase());

  function select(name: string) {
    onChange(name);
    setOpen(false);
  }

  function scheduleClose() {
    if (closeTimer.current !== null) clearTimeout(closeTimer.current);
    // Long enough for a click on an option to land before the list unmounts.
    closeTimer.current = setTimeout(() => {
      setOpen(false);
      onBlur?.();
    }, 120);
  }

  return (
    <div className="relative">
      <input
        id={id}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        value={value}
        maxLength={40}
        placeholder="Select or type a category"
        onChange={(event) => {
          onChange(event.target.value);
          setOpen(true);
          setHighlighted(0);
        }}
        onFocus={() => setOpen(true)}
        onBlur={scheduleClose}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            if (open) {
              event.stopPropagation();
              setOpen(false);
            }
            return;
          }
          if (!open || matches.length === 0) return;
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setHighlighted((i) => (i + 1) % matches.length);
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlighted((i) => (i - 1 + matches.length) % matches.length);
          } else if (event.key === "Enter" && matches[highlighted]) {
            event.preventDefault();
            select(matches[highlighted].name);
          }
        }}
        className="w-full rounded-card border border-border bg-inset px-3 py-2 pr-8 text-sm text-fg
                   placeholder:text-fg-subtle focus:border-border-hover focus:outline-none
                   focus:ring-2 focus:ring-accent/35"
      />
      <ChevronDown
        className="pointer-events-none absolute right-2.5 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
        aria-hidden="true"
      />

      {open && (matches.length > 0 || (value.trim() !== "" && !exact)) && (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-10 mt-1 max-h-56 w-full overflow-auto rounded-card border
                     border-border bg-surface py-1 shadow-overlay"
        >
          {matches.map((category, index) => (
            <li key={category.name}>
              <button
                type="button"
                role="option"
                aria-selected={category.name === value}
                // Fires before the input's blur, so the click still lands.
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(category.name)}
                className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm
                            transition-colors ${
                              index === highlighted
                                ? "bg-surface-hover text-fg"
                                : "text-fg-muted hover:bg-surface-hover hover:text-fg"
                            }`}
              >
                <span>{category.name}</span>
                <span className="font-mono text-xs text-fg-subtle tabular-nums">{category.count}</span>
              </button>
            </li>
          ))}
          {value.trim() !== "" && !exact && (
            <li className="px-3 py-1.5 text-xs text-fg-subtle">
              “{value.trim()}” will be added as a new category
            </li>
          )}
        </ul>
      )}
    </div>
  );
}
