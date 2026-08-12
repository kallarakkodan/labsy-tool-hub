# 21 — proxy.ts route guard, security headers, CSRF origin check

Status: resolved
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

- [x] `/admin` unauthenticated redirects to `/admin/login` (PRD §14)
- [x] `curl /api/browse` with no cookie returns 401 JSON, not an HTML redirect
- [x] Headers present on both a page response and an API response
- [x] A cross-origin POST with a foreign `Origin` is rejected

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

## Answer

`src/proxy.ts` plus `src/app/not-found.tsx`, with 22 tests in `tests/proxy.test.ts`.
Verified against a **production** build (`pnpm build && pnpm start`), because the
CSP branches on `NODE_ENV` and `next dev` would have proved nothing:

```
GET  /admin                     307 -> /admin/login?next=%2Fadmin
GET  /admin/tools?q=iso         307 -> /admin/login?next=%2Fadmin%2Ftools%3Fq%3Diso
GET  /api/browse                401 application/json
                                {"error":{"code":"UNAUTHORIZED","message":"…"}}
POST Origin: https://evil.example  403
GET  /                          csp + nosniff + DENY + same-origin
GET  /api/download/<slug>        200, content-length 118000000, accept-ranges
     with Range: 0-1023          206, content-range bytes 0-1023/118000000
```

In Chrome against the production build: console clean on `/`, `/admin/login`
and a 404; every `<script>` on a rendered page carries the nonce; clicking a
category pill updated the URL, which is hydration actually working rather than
HTML that merely looks right. The wrong-password state rendered as
"Incorrect password. 3 attempts left before a 15-minute lockout."

Decisions:

- **The matcher deliberately includes `/api/**`.** Every CSP example excludes it,
  and copying that would have silently taken the 401 guard and the CSRF check
  with it. Only `_next/static`, `_next/image` and `favicon.ico` are excluded.
- **CSRF allows a missing `Origin`.** Browsers attach it to every non-GET/HEAD
  request, so absence means a non-browser client — and CSRF is by definition an
  attack run through someone else's browser. Requiring it would break every
  `curl` caller to defend against nothing. `X-Forwarded-Host` is accepted
  alongside `Host` because not every NPM configuration preserves the original,
  and rejecting on that difference would 403 every admin mutation in production
  while working perfectly in dev.
- **CSRF is checked before the session.** A cross-origin `DELETE` carrying a
  valid cookie is refused at 403, which is the case that matters.
- **Scripts are allowed by nonce + `strict-dynamic`, not `unsafe-inline`.**
  `unsafe-eval` and inline styles appear only under `NODE_ENV=development`,
  where React rebuilds server stacks with `eval` and Turbopack injects style
  tags for HMR. `upgrade-insecure-requests` is production-only: over
  `http://localhost` it would upgrade the dev server's own asset requests.
- **`img-src` allows `https:`,** because `Tool.iconUrl` may be a remote image
  (PRD §6). The exposure is an image request, available only to an attacker who
  already has script execution — which is what the directive above prevents.

### Found while verifying: the CSP broke the 404 page

Nonce-based CSP requires dynamic rendering — Next stamps the nonce in from the
request, so a statically generated page has none. `/_not-found` was the one
static route left in the app, and its 12 inline scripts came back un-nonced:
the page rendered but never hydrated, so client navigation away from a 404 was
dead. `src/app/not-found.tsx` calls `connection()` to put it back on the dynamic
path, and takes the opportunity to replace Next's default 404 with one built
from the design tokens. Every route is now `ƒ`, and the count of un-nonced
scripts on that page is 0.
