import { PackageOpen, SearchX } from "lucide-react";

/*
 * The three non-happy states every list surface owes (PRD §5.5).
 *
 * Loading is a skeleton matching the final layout, never a centred spinner.
 * Empty carries one line of copy and, where relevant, one action. Errors say
 * what failed and what to do next — never "Something went wrong."
 */

/** Shaped blocks, no fake words: CONTEXT §10 bans Lorem Ipsum in skeletons too. */
export function ToolGridSkeleton({ count = 6 }: { count?: number }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3" aria-hidden="true">
      {Array.from({ length: count }, (_, i) => (
        <div key={i} className="rounded-card border border-border bg-surface p-5">
          <div className="flex items-start justify-between">
            <div className="size-10 rounded-card bg-inset" />
            <div className="h-3 w-16 rounded-button bg-inset" />
          </div>
          <div className="mt-4 h-4 w-3/4 rounded-button bg-inset" />
          <div className="mt-2 h-3 w-full rounded-button bg-inset" />
          <div className="mt-1.5 h-3 w-2/3 rounded-button bg-inset" />
          <div className="mt-4 border-t border-border pt-3">
            <div className="h-3 w-1/2 rounded-button bg-inset" />
          </div>
        </div>
      ))}
    </div>
  );
}

/** The catalogue is genuinely empty. Copy is verbatim from CONTEXT §10. */
export function NoToolsYet() {
  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
      <PackageOpen className="size-8 text-fg-subtle" aria-hidden="true" />
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">No tools yet.</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        Add your first tool from the admin panel, or point the hub at a file already on the server.
      </p>
      <a
        href="/admin"
        className="mt-5 rounded-button bg-accent px-4 py-2 text-sm font-medium text-base transition-colors
                   hover:bg-accent-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        Open the admin panel
      </a>
    </div>
  );
}

/**
 * Tools exist, the filters matched none. A distinct state from the above: telling
 * someone there are no tools when they have simply mistyped a search is a small
 * lie that costs them a support message.
 */
export function NoMatches({ query, category, onClear }: { query: string; category: string | null; onClear: () => void }) {
  const described =
    query.trim() !== "" && category !== null
      ? `“${query.trim()}” in ${category}`
      : query.trim() !== ""
        ? `“${query.trim()}”`
        : category;

  return (
    <div className="flex flex-col items-center rounded-card border border-dashed border-border bg-surface px-6 py-16 text-center">
      <SearchX className="size-8 text-fg-subtle" aria-hidden="true" />
      <h2 className="mt-4 text-[15px] font-semibold tracking-[-0.02em] text-fg">No tools match {described}.</h2>
      <p className="mt-1 max-w-md text-sm text-fg-muted">
        Check the spelling, or widen the filter.
      </p>
      <button
        type="button"
        onClick={onClear}
        className="mt-5 rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                   transition-colors hover:border-border-hover hover:bg-surface-hover
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        Clear filters
      </button>
    </div>
  );
}

/** Says what failed and what to do next (PRD §5.5). */
export function CatalogueError() {
  return (
    <div className="rounded-card border border-danger/40 bg-danger/10 px-5 py-4">
      <h2 className="text-sm font-semibold text-danger">The catalogue could not be loaded.</h2>
      <p className="mt-1 text-sm text-fg-muted">
        The hub could not reach its database. Reload the page; if it keeps failing, check the
        service with <span className="font-mono text-xs">systemctl status labsy-hub</span>.
      </p>
    </div>
  );
}
