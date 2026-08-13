/**
 * Runs once per server instance, before the server accepts requests. This is the
 * boot gate for CONTEXT §3: a misconfigured service exits non-zero here rather
 * than starting and failing on the first request that happens to need the bad value.
 *
 * Next bundles this file for the Edge instrumentation as well as Node, and
 * `lib/env.ts` uses `node:fs` and `process.exit` — neither of which exists on
 * Edge. The dynamic import behind the `NEXT_RUNTIME` check keeps it out of that
 * bundle entirely; a static import warns at build time and would fail if it ran.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { assertEnv } = await import("@/lib/env");
  assertEnv();

  // journal_mode is stored in the database file, so this only has to win once —
  // but it has to win at least once, and boot is the only place that is certain.
  const { ensureWal } = await import("@/lib/db");
  await ensureWal();

  // Reaps expired uploads on boot, then hourly (PRD §9.5, issue 28).
  const { startUploadJanitor } = await import("@/lib/upload-janitor");
  startUploadJanitor();
}
