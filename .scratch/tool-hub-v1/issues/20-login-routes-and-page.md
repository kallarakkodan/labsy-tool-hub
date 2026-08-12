# 20 — Login/logout routes and the login page

Status: ready-for-agent
Phase: P2
Blocked by: 18, 19
Spec: PRD §8.1, PRD §9.2, PRD §14 (Admin)

## Why

The one place a shared password is accepted. Everything about it — rate limit,
audit trail, cookie flags — is spelled out in PRD §8.1.

## Scope

- `POST /api/auth/login` — `{ password }`, rate limited per issue 19, sets the
  sealed cookie on success, `401` on failure, `429` when limited.
  Failures write an `auth.login.fail` row to `AuditLog` with `actorIp`.
- `POST /api/auth/logout` — clears the cookie.
- `/admin/login` page: single password field, no username. Token-set styling,
  the input recipe from CONTEXT §5. Shows the remaining-attempts / retry-after
  state clearly rather than a generic error.
- Redirects to the `?next=` path after login when it is a same-origin
  `/admin/**` path, otherwise `/admin`.

## Done when

- [ ] Wrong password 6× returns 429 (PRD §14)
- [ ] Session survives a reload and expires after 8 hours
- [ ] The set cookie carries `Secure`, `HttpOnly`, `SameSite=Lax`
- [ ] Login failures appear in `AuditLog`

## Watch out

- The `?next=` value is attacker-controllable — validate it is a relative
  `/admin/**` path before redirecting, never an absolute URL.
- Do not reveal whether the rate limit or the password was the reason for a
  rejection in a way that helps enumeration; a shared single password makes this
  mostly moot, but keep messages generic.
- `COOKIE_SECURE=false` over `http://localhost` is the only dev escape hatch; the
  boot check from issue 03 already prevents it in production.
