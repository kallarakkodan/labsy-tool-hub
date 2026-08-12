import Link from "next/link";
import { connection } from "next/server";

/*
 * A 404 that matches the design system, and — the reason it is a file at all —
 * one that is *dynamically* rendered.
 *
 * The CSP in `src/proxy.ts` allows scripts by nonce. Next stamps that nonce in
 * while rendering, from the CSP header on the request, so a statically generated
 * page has no nonce to stamp: its inline bootstrap is blocked and the page never
 * hydrates. Next's built-in 404 is static, which made this the one route in the
 * app that the CSP broke. `connection()` waits for a real request and puts it
 * back on the dynamic path.
 */
export default async function NotFound() {
  await connection();

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[480px] flex-col justify-center px-6 py-16">
      <p className="font-mono text-xs text-fg-subtle tabular-nums">404</p>
      <h1 className="mt-2 text-lg font-semibold text-fg">That page is not here.</h1>
      <p className="mt-1 text-sm text-fg-muted">
        The link may be stale, or the tool it pointed at may have been removed from the catalogue.
      </p>

      <Link
        href="/"
        className="mt-6 w-fit rounded-button border border-border bg-surface px-4 py-2 text-sm text-fg
                   transition-colors hover:border-border-hover hover:bg-surface-hover
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        Back to the catalogue
      </Link>
    </main>
  );
}
