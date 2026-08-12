"use client";

import { useEffect, useState } from "react";

/*
 * LAN status dot (PRD §7.1). Polls /api/health every 30s.
 *
 * Three states, not two: "checking" is distinct from "down" because the
 * endpoint answers 200 with `ok: false` when degraded, and the operator needs
 * to tell "the service is up but the storage root is unwritable" from "the
 * service is unreachable".
 */

type Status = "checking" | "ok" | "degraded" | "down";

const POLL_INTERVAL_MS = 30_000;

const STATUS_TEXT: Record<Status, string> = {
  checking: "Checking hub status",
  ok: "Hub online",
  degraded: "Hub degraded — check the service logs",
  down: "Hub unreachable",
};

const DOT_CLASS: Record<Status, string> = {
  checking: "bg-warning",
  ok: "bg-accent",
  degraded: "bg-warning",
  down: "bg-danger",
};

export function HealthDot() {
  const [status, setStatus] = useState<Status>("checking");
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    let timer: ReturnType<typeof setTimeout>;

    async function poll() {
      try {
        const response = await fetch("/api/health", {
          signal: controller.signal,
          cache: "no-store",
        });
        const body: unknown = await response.json();
        const health = body as { ok?: boolean; version?: string };

        setStatus(health.ok === true ? "ok" : "degraded");
        setVersion(health.version ?? null);
      } catch {
        // An aborted fetch during unmount must not paint the dot red.
        if (!controller.signal.aborted) setStatus("down");
      } finally {
        if (!controller.signal.aborted) timer = setTimeout(poll, POLL_INTERVAL_MS);
      }
    }

    void poll();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, []);

  return (
    <div className="flex items-center gap-2.5">
      <span className="flex items-center gap-1.5">
        {/* 6px status dot — one of the two rounded-full exceptions in PRD §5.3. */}
        {/* eslint-disable-next-line no-restricted-syntax -- status dot ≤8px, permitted by PRD §5.3 */}
        <span className={`size-1.5 rounded-full ${DOT_CLASS[status]}`} aria-hidden="true" />
        {/* Colour alone is not a status. */}
        <span className="sr-only" role="status">
          {STATUS_TEXT[status]}
        </span>
        <span className="hidden text-xs text-fg-muted sm:inline" title={STATUS_TEXT[status]}>
          {status === "ok" ? "LAN" : status === "checking" ? "…" : "!"}
        </span>
      </span>

      {version !== null && (
        <span className="hidden font-mono text-xs tabular-nums text-fg-subtle md:inline">
          v{version}
        </span>
      )}
    </div>
  );
}
