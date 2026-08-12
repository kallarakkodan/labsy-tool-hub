import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, unsealToken } from "@/lib/auth";
import { safeNextPath } from "@/lib/request";

/*
 * The single guard over every admin surface (PRD §8.1, §11.2).
 *
 * Next 16 renamed `middleware.ts` to `proxy.ts` and pinned it to the Node.js
 * runtime — the `runtime` segment option is not merely unnecessary here, it
 * throws. That is what lets this decrypt a real session with `node:crypto`
 * instead of checking whether a cookie is merely present (ADR-0001). A
 * presence-only guard is the trap CONTEXT §2 item 7 describes for visibility:
 * it looks authoritative, so the next handler assumes it ran, and nothing fails
 * loudly when it did not.
 *
 * Three jobs, in this order:
 *   1. CSRF — reject a state-changing request from a foreign origin.
 *   2. Auth — redirect guarded pages, 401 guarded APIs.
 *   3. Headers — security headers and a per-request CSP nonce on everything.
 *
 * The order matters: a cross-origin POST is refused before it can reach a
 * handler, whether or not it carries a valid session.
 */

/** Pages behind the session. `/admin/login` is carved out below. */
const ADMIN_PAGES = "/admin";
const LOGIN_PATH = "/admin/login";

/** API groups that answer 401 JSON rather than redirecting (PRD §8.1). */
const GUARDED_APIS = ["/api/admin", "/api/browse", "/api/uploads"];

/** Everything a browser will not send cross-origin without the user meaning it. */
const MUTATING_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const nonce = Buffer.from(crypto.randomUUID()).toString("base64");
  const csp = contentSecurityPolicy(nonce);

  if (MUTATING_METHODS.has(request.method) && !isSameOrigin(request)) {
    return secured(
      NextResponse.json(
        { error: { code: "FORBIDDEN", message: "Cross-origin request refused." } },
        { status: 403 },
      ),
      csp,
    );
  }

  const guardedApi = GUARDED_APIS.some((prefix) => isUnder(pathname, prefix));
  const guardedPage = isUnder(pathname, ADMIN_PAGES) && pathname !== LOGIN_PATH;

  if ((guardedApi || guardedPage) && !(await hasSession(request))) {
    if (guardedApi) {
      return secured(
        NextResponse.json(
          { error: { code: "UNAUTHORIZED", message: "Sign in to the admin panel to do that." } },
          { status: 401 },
        ),
        csp,
      );
    }

    /*
     * `safeNextPath` runs on the way *out* as well as on the way in. The path
     * here comes from the URL the visitor asked for, so it is already
     * same-origin — but round-tripping it through the same validator the login
     * page uses means the two can never disagree about what is redirectable.
     */
    const login = request.nextUrl.clone();
    login.pathname = LOGIN_PATH;
    login.search = "";
    login.searchParams.set("next", safeNextPath(`${pathname}${search}`));

    return secured(NextResponse.redirect(login), csp);
  }

  /*
   * The nonce goes onto the *request* so Next can stamp it into its own inline
   * bootstrap script while rendering, and onto the response so the browser
   * enforces it. Both are required; setting only one silently breaks hydration.
   */
  const headers = new Headers(request.headers);
  headers.set("x-nonce", nonce);
  headers.set("content-security-policy", csp);

  return secured(NextResponse.next({ request: { headers } }), csp);
}

/*
 * Runs on everything except the immutable static assets, which need no guard and
 * no CSP of their own. `/api/**` is deliberately *included* — excluding it, as
 * most CSP examples do, would take the 401 guard and the CSRF check with it.
 */
export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};

/** `/api/admin` matches `/api/admin` and `/api/admin/x`, but not `/api/administrators`. */
function isUnder(pathname: string, prefix: string): boolean {
  return pathname === prefix || pathname.startsWith(`${prefix}/`);
}

async function hasSession(request: NextRequest): Promise<boolean> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token === undefined) return false;
  return (await unsealToken(token)) !== null;
}

/**
 * CSRF: `Origin` must match the host we were reached on (PRD §11.2).
 *
 * **A missing `Origin` is allowed**, and that is not a hole. Browsers attach
 * `Origin` to every request that is not GET or HEAD, so its absence means a
 * non-browser client — `curl`, a script, a download manager — and CSRF is by
 * definition an attack carried out by someone else's browser. Requiring the
 * header would break every command-line caller to defend against nothing.
 *
 * `X-Forwarded-Host` is accepted alongside `Host` because two proxy hops sit in
 * front (PRD §12.4) and not every NPM configuration preserves the original Host.
 * Rejecting on that difference would 403 every admin mutation in production
 * while working perfectly in dev.
 */
function isSameOrigin(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return true;

  let originHost: string;
  try {
    // A sandboxed iframe sends the literal "null", which is not a URL — and is
    // exactly the case this must refuse.
    originHost = new URL(origin).host;
  } catch {
    return false;
  }

  const forwarded = request.headers.get("x-forwarded-host");
  return originHost === request.headers.get("host") || originHost === forwarded;
}

/** Applied to every response the guard touches, including its own refusals. */
function secured(response: NextResponse, csp: string): NextResponse {
  response.headers.set("content-security-policy", csp);
  response.headers.set("x-content-type-options", "nosniff");
  response.headers.set("x-frame-options", "DENY");
  response.headers.set("referrer-policy", "same-origin");
  return response;
}

function contentSecurityPolicy(nonce: string): string {
  const isDev = process.env.NODE_ENV === "development";

  /*
   * `'unsafe-eval'` and inline styles are **development only**. React uses
   * `eval` in dev to rebuild server stack traces in the browser, and Turbopack
   * injects style tags for HMR; neither happens in a production build, which is
   * what PRD §11.2's "a CSP without unsafe-eval" is about.
   *
   * Scripts are allowed by nonce plus `'strict-dynamic'` rather than by
   * `'unsafe-inline'`: Next stamps the nonce into its own bootstrap script and
   * `strict-dynamic` lets that script pull in the rest of the bundle, so no
   * blanket inline permission is needed. This does mean every page must be
   * dynamically rendered — a statically generated page is built with no request
   * and so carries no nonce.
   *
   * `img-src` allows `https:` because `Tool.iconUrl` may be a remote image
   * (PRD §6). The exposure is an image request, and only to an attacker who
   * already has script execution — which the directive above is what prevents.
   */
  return [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${isDev ? " 'unsafe-eval'" : ""}`,
    `style-src 'self' ${isDev ? "'unsafe-inline'" : `'nonce-${nonce}'`}`,
    "img-src 'self' blob: data: https:",
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    // Only in production: over `http://localhost` this would upgrade the dev
    // server's own asset requests to a scheme nothing is listening on.
    ...(isDev ? [] : ["upgrade-insecure-requests"]),
  ].join("; ");
}
