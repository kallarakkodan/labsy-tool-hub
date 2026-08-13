"use client";

import { useEffect, useState, type FormEvent } from "react";
import { LoaderCircle, LockKeyhole } from "lucide-react";

/*
 * The password field (PRD §8.1, issue 20).
 *
 * The API's message is deliberately uninformative — it is what an
 * unauthenticated caller sees. This component reads the two headers instead
 * (`X-RateLimit-Remaining`, `Retry-After`) and tells the admin exactly where
 * they stand, which is the difference between "wrong password" and twelve
 * minutes of wondering whether the service is broken.
 */

type State =
  | { kind: "idle" }
  | { kind: "submitting" }
  /** The server accepted the attempt and refused it. `remaining` may be unknown. */
  | { kind: "rejected"; remaining: number | null }
  | { kind: "locked" }
  | { kind: "offline" };

/** Fallback when a 429 arrives without a parseable `Retry-After`. */
const DEFAULT_LOCK_SECONDS = 15 * 60;

export function LoginForm({ next }: { next: string }) {
  const [password, setPassword] = useState("");
  const [state, setState] = useState<State>({ kind: "idle" });
  const [lockSeconds, setLockSeconds] = useState(0);

  const locked = lockSeconds > 0;
  const busy = state.kind === "submitting";

  // One interval for the whole lockout, started when it begins and cleared when
  // it ends — not one per tick.
  useEffect(() => {
    if (!locked) return;
    const timer = setInterval(() => setLockSeconds((left) => Math.max(0, left - 1)), 1000);
    return () => clearInterval(timer);
  }, [locked]);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || locked) return;

    setState({ kind: "submitting" });

    let response: Response;
    try {
      response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
    } catch {
      setState({ kind: "offline" });
      return;
    }

    if (response.ok) {
      setPassword("");
      /*
       * A hard navigation, not `router.replace()`: the soft client-side router
       * fetches the destination's RSC payload itself, fire-and-forget, with no
       * error handling or timeout anywhere in this component — if that fetch is
       * slow or fails (a flaky proxy hop, a loaded host, anything transient),
       * the promise just never resolves and the button is stuck on "Signing in"
       * forever with no way out. `window.location.assign` is a plain browser
       * navigation instead: the browser's own request/retry/error handling
       * applies, and it can never leave this component in a stuck state because
       * the component itself is about to be torn down either way. It also reads
       * the session cookie fresh by construction, so there is no stale-RSC-cache
       * concern `router.refresh()` existed to work around.
       */
      window.location.assign(next);
      return;
    }

    const retryAfter = Number(response.headers.get("Retry-After"));
    if (Number.isFinite(retryAfter) && retryAfter > 0) {
      setLockSeconds(retryAfter);
    } else if (response.status === 429) {
      setLockSeconds(DEFAULT_LOCK_SECONDS);
    }

    if (response.status === 429) {
      setState({ kind: "locked" });
      return;
    }

    const header = response.headers.get("X-RateLimit-Remaining");
    setState({ kind: "rejected", remaining: header === null ? null : Number(header) });
  }

  return (
    <form onSubmit={onSubmit} className="mt-6">
      <label htmlFor="password" className="block text-sm font-medium text-fg">
        Password
      </label>

      <div className="relative mt-2">
        <LockKeyhole
          className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-fg-subtle"
          aria-hidden="true"
        />
        <input
          id="password"
          name="password"
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          autoComplete="current-password"
          autoFocus
          required
          disabled={locked}
          aria-describedby="login-status"
          aria-invalid={state.kind === "rejected"}
          className="w-full rounded-card border border-border bg-inset py-2 pl-9 pr-3 text-sm text-fg
                     placeholder:text-fg-subtle focus:border-border-hover focus:outline-none
                     focus:ring-2 focus:ring-accent/35 disabled:opacity-50"
        />
      </div>

      <button
        type="submit"
        disabled={busy || locked || password === ""}
        className="mt-4 flex w-full items-center justify-center gap-2 rounded-button bg-accent px-4 py-2
                   text-sm font-medium text-base transition-colors hover:bg-accent-hover
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        {busy && <LoaderCircle className="size-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}
        {busy ? "Signing in" : "Sign in"}
      </button>

      {/*
        Polite, not assertive: the message replaces itself on every attempt and
        an assertive region would interrupt a screen reader mid-word each time.
      */}
      <p id="login-status" role="status" aria-live="polite" className="mt-3 min-h-[1.25rem] text-sm">
        <StatusMessage state={state} lockSeconds={lockSeconds} />
      </p>
    </form>
  );
}

function StatusMessage({ state, lockSeconds }: { state: State; lockSeconds: number }) {
  if (lockSeconds > 0) {
    return (
      <span className="text-danger">
        Too many failed attempts. Try again in{" "}
        <span className="font-mono tabular-nums">{formatCountdown(lockSeconds)}</span>.
      </span>
    );
  }

  switch (state.kind) {
    case "rejected":
      return (
        <span className="text-danger">
          Incorrect password.
          {state.remaining !== null && state.remaining > 0 && (
            <>
              {" "}
              <span className="text-fg-muted">
                {state.remaining} {state.remaining === 1 ? "attempt" : "attempts"} left before a
                15-minute lockout.
              </span>
            </>
          )}
        </span>
      );
    case "locked":
      // Reachable only in the instant between a 429 and the countdown starting.
      return <span className="text-danger">Too many failed attempts.</span>;
    case "offline":
      return <span className="text-warning">Could not reach the hub. Check the connection and retry.</span>;
    default:
      return null;
  }
}

/** `12:04`, counting down. Minutes and seconds, because 15 minutes never needs hours. */
function formatCountdown(totalSeconds: number): string {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}:${String(seconds).padStart(2, "0")}`;
}
