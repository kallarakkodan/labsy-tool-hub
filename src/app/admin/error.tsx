"use client";

import { useEffect } from "react";

/**
 * Error boundary for the dashboard (PRD §5.5). Says what failed and what to do
 * next — never "Something went wrong."
 *
 * Realistically this fires when SQLite is unreachable or the storage root has
 * gone away, which is why the copy points at the service rather than leaving the
 * reader to guess.
 */
export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error("[admin]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <div className="rounded-card border border-danger/40 bg-danger/10 px-5 py-4">
        <h1 className="text-sm font-semibold text-danger">The dashboard could not be loaded.</h1>
        <p className="mt-1 text-sm text-fg-muted">
          The hub could not read its catalogue. Retry below; if it keeps failing, check the service
          with <span className="font-mono text-xs">systemctl status labsy-hub</span> and the
          permissions on the storage root.
        </p>
        <button
          type="button"
          onClick={reset}
          className="mt-4 rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                     transition-colors hover:border-border-hover hover:bg-surface-hover
                     focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
        >
          Retry
        </button>
      </div>
    </main>
  );
}
