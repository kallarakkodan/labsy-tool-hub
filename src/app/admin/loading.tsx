/**
 * Route-level skeleton for the dashboard (PRD §5.5) — the shape of the final
 * table, never a centred spinner, and no fake words (CONTEXT §10).
 *
 * This also covers `/admin/login`, whose form renders instantly; a skeleton that
 * flashes for one frame there is a better trade than no loading state on the
 * table, which reads the whole catalogue.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6" aria-hidden="true">
      <div className="flex items-center justify-between">
        <div className="h-6 w-24 rounded-button bg-inset" />
        <div className="h-9 w-36 rounded-button bg-inset" />
      </div>

      <div className="mt-5 flex gap-3">
        <div className="h-9 w-full max-w-[320px] rounded-card bg-inset" />
        <div className="h-9 w-40 rounded-card bg-inset" />
        <div className="h-9 w-24 rounded-button bg-inset" />
      </div>

      <div className="mt-5 rounded-card border border-border bg-surface">
        {Array.from({ length: 6 }, (_, row) => (
          <div key={row} className="flex items-center gap-4 border-b border-border/60 px-3 py-3 last:border-0">
            <div className="h-4 w-1/4 rounded-button bg-inset" />
            <div className="h-4 w-20 rounded-button bg-inset" />
            <div className="h-4 w-16 rounded-button bg-inset" />
            <div className="h-4 w-1/5 rounded-button bg-inset" />
            <div className="ml-auto h-4 w-24 rounded-button bg-inset" />
          </div>
        ))}
      </div>
    </main>
  );
}
