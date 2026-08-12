# ADR-0001 — Session cookies are JWE tokens via `jose`

Status: accepted
Date: 2026-08-12
Relates to: PRD §4 (tech stack), PRD §8.1 (authentication), PRD §16 D1

> **Revised the same day, before any code was written.** The first version of this
> ADR justified the choice by an Edge-runtime constraint and mandated a two-module
> split to satisfy it. That premise was wrong for the version we actually build on:
> Next.js 16 renames `middleware.ts` to `proxy.ts` and runs it on the **Node.js**
> runtime, not configurable to Edge. The decision below is the corrected one. The
> superseded reasoning is kept at the bottom because "why isn't this split into two
> modules?" is exactly the question a reader will arrive with.

## Context

PRD §4 leaves the session mechanism as "`iron-session` **or** `jose` JWT" and does
not pick. PRD §8.1 requires the route guard to redirect `/admin/**` and return 401
JSON for `/api/admin/**`, `/api/browse`, `/api/uploads/**`.

In Next.js 16 that guard lives in `proxy.ts` and runs on the Node.js runtime
(`node_modules/next/dist/docs/01-app/02-guides/upgrading/version-16.md`,
"`middleware` to `proxy`"). Both candidate libraries therefore work, and the
choice is on merit rather than runtime capability.

## Decision

Sessions are compact **JWE** tokens produced by `jose`: `alg: "dir"`,
`enc: "A256GCM"`, key derived from `AUTH_SECRET` via HKDF-SHA256. Encrypted rather
than merely signed, so the payload is opaque to the client.

Everything lives in **`lib/auth.ts`**, as PRD §10's directory layout already
specifies — `verifyPassword()` (scrypt, `node:crypto`) alongside `seal()`,
`unseal()`, `getSession()`, and `isAdmin()`. One module, imported by `proxy.ts`
and by route handlers alike.

`jose` over `iron-session` on two small margins: it is explicit about the
algorithm and key derivation, which suits a file whose whole job is a security
boundary, and it has no dependencies. The cookie plumbing `iron-session` would
have handled is about fifteen lines.

## Consequences

- Sessions are **stateless** — there is no server-side revocation. Logout clears
  the cookie; a stolen cookie stays valid until its 8-hour expiry. Acceptable
  under PRD §11.4's trusted-LAN boundary with one shared password. Rotating
  `AUTH_SECRET` invalidates every session at once, which is the break-glass.
- `proxy.ts` performs a real AES-GCM decrypt per guarded request. Negligible, and
  it happens on requests that were going to hit the DB anyway.
- The guard does **real verification**, not a cookie-presence check. That matters:
  a presence-only guard produces the failure mode CONTEXT §2 item 7 describes for
  visibility — a check that looks authoritative, so the next handler written
  quietly assumes it already ran, and nothing fails loudly when it didn't.

## Revisit if

Per-user accounts arrive (PRD §11.4 names them as the gap if the app is ever
exposed beyond the LAN). Revocation becomes a real requirement then, and a
session table starts paying for itself.

## Superseded reasoning (kept deliberately)

The original decision split the code into `lib/session.ts` (Edge-safe, `jose`
only) and `lib/auth.ts` (Node-only, scrypt), because Next.js 15 middleware ran on
Edge, where `node:crypto` is unavailable and a single module would have dragged it
into the Edge bundle and failed the build.

Under `proxy.ts` on Node that constraint does not exist, so the split would be
ceremony defending against nothing — and it would contradict PRD §10 for no gain.
If this project ever moves the guard back to a genuine Edge `middleware.ts`, the
split becomes necessary again, and this section is the instruction for doing it.
