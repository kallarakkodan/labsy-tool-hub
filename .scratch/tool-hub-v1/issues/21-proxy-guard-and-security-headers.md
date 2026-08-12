# 21 — proxy.ts route guard, security headers, CSRF origin check

Status: ready-for-agent
Phase: P2
Blocked by: 20
Spec: PRD §8.1, PRD §11.2, PRD §14 (Admin)

## Why

One guard covering every admin surface, rather than an auth check remembered
individually in each handler.

## Scope

- `src/proxy.ts` — Next 16's name for `middleware.ts`, exporting
  `export function proxy(request)` and running on the **Node.js** runtime:
  - `/admin/**` → redirect to `/admin/login?next=…` when unauthenticated
  - `/api/admin/**`, `/api/browse`, `/api/uploads/**` → `401` JSON (through the
    `apiError` envelope, not a bare status)
  - `/admin/login` itself excluded from the guard
- Security headers on all responses: `X-Content-Type-Options: nosniff`,
  `X-Frame-Options: DENY`, `Referrer-Policy: same-origin`, and a CSP **without**
  `unsafe-eval`.
- CSRF: `Origin`/`Host` match check on every state-changing request
  (POST/PUT/PATCH/DELETE), rejecting a mismatch with `403`.

## Done when

- [ ] `/admin` unauthenticated redirects to `/admin/login` (PRD §14)
- [ ] `curl /api/browse` with no cookie returns 401 JSON, not an HTML redirect
- [ ] Headers present on both a page response and an API response
- [ ] A cross-origin POST with a foreign `Origin` is rejected

## Watch out

- The guard does a **real** `getSession()` decrypt, not a cookie-presence check
  ([ADR-0001](../../../docs/adr/0001-session-format-jose-jwe.md)). A presence-only
  guard is the same trap CONTEXT §2 item 7 describes for visibility: it looks
  authoritative, so the next handler assumes it ran, and nothing fails loudly.
- Read `node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md`
  before writing it — the matcher config and response API differ from
  `middleware.ts` as most references describe it.
- The CSP must still permit the self-hosted fonts and Next's inline bootstrap
  script — verify with the console clean, not by adding `unsafe-inline` blindly.
