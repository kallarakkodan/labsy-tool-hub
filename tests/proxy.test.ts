import { beforeAll, describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { resetEnvCache } from "../src/lib/env";

/*
 * The guard (issue 21). Everything here is a real decrypt — `unsealToken` is
 * never mocked, because a guard that trusts the *presence* of a cookie is the
 * exact failure ADR-0001 exists to prevent, and mocking the session away would
 * make this suite pass either way.
 */

const ORIGIN = "https://hub.labsy.internal";
let sealed: string;

beforeAll(async () => {
  process.env.STORAGE_ROOT = ".";
  process.env.DATABASE_URL = "file:./test.db";
  process.env.AUTH_SECRET = "a".repeat(48);
  process.env.SESSION_TTL_HOURS = "8";
  process.env.ADMIN_PASSWORD_HASH = "scrypt$16384$8$1$c2FsdA==$aGFzaA==";
  resetEnvCache();

  const { sealToken } = await import("../src/lib/auth");
  sealed = await sealToken();
});

interface CallOptions {
  method?: string;
  session?: string | false;
  origin?: string;
  headers?: Record<string, string>;
}

async function call(path: string, options: CallOptions = {}) {
  const { proxy } = await import("../src/proxy");
  const { SESSION_COOKIE } = await import("../src/lib/auth");

  const headers = new Headers({ host: "hub.labsy.internal", ...options.headers });
  if (options.origin !== undefined) headers.set("origin", options.origin);
  if (options.session !== undefined && options.session !== false) {
    headers.set("cookie", `${SESSION_COOKIE}=${options.session}`);
  }

  return proxy(new NextRequest(new URL(path, ORIGIN), { method: options.method ?? "GET", headers }));
}

describe("page guard", () => {
  it("redirects /admin to the login page with a next= pointer (PRD §14)", async () => {
    const response = await call("/admin");

    expect(response.status).toBe(307);
    const location = new URL(response.headers.get("location")!);
    expect(location.pathname).toBe("/admin/login");
    expect(location.searchParams.get("next")).toBe("/admin");
  });

  it("carries the query string through the round trip", async () => {
    const response = await call("/admin/tools?category=OS%20Images");

    const location = new URL(response.headers.get("location")!);
    expect(location.searchParams.get("next")).toBe("/admin/tools?category=OS%20Images");
  });

  it("never redirects the login page to itself", async () => {
    expect((await call("/admin/login")).headers.get("location")).toBeNull();
    expect((await call("/admin/login?next=/admin")).headers.get("location")).toBeNull();
  });

  it("lets a real session through", async () => {
    expect((await call("/admin", { session: sealed })).headers.get("location")).toBeNull();
  });

  it("is not fooled by a cookie that merely exists (ADR-0001)", async () => {
    for (const forged of ["yes", "admin=true", `${sealed}x`, sealed.slice(0, -4)]) {
      const response = await call("/admin", { session: forged });
      expect(response.status).toBe(307);
    }
  });

  it("leaves the public catalogue alone", async () => {
    for (const path of ["/", "/api/tools", "/api/health", "/api/download/abc"]) {
      expect((await call(path)).headers.get("location")).toBeNull();
    }
  });

  it("does not guard a path that merely starts with the same letters", async () => {
    expect((await call("/administrators")).headers.get("location")).toBeNull();
  });
});

describe("API guard", () => {
  const guarded = ["/api/admin", "/api/admin/tools", "/api/browse", "/api/uploads/abc/1"];

  it("answers 401 JSON, never an HTML redirect", async () => {
    for (const path of guarded) {
      const response = await call(path);

      expect(response.status).toBe(401);
      expect(response.headers.get("content-type")).toContain("application/json");
      await expect(response.json()).resolves.toMatchObject({ error: { code: "UNAUTHORIZED" } });
    }
  });

  it("lets a real session through", async () => {
    for (const path of guarded) {
      expect((await call(path, { session: sealed })).status).toBe(200);
    }
  });

  it("does not guard /api/administrators or /api/browsers", async () => {
    expect((await call("/api/administrators")).status).toBe(200);
    expect((await call("/api/browsers")).status).toBe(200);
  });

  it("leaves the login route reachable — it is how a session is obtained", async () => {
    const response = await call("/api/auth/login", { method: "POST", origin: ORIGIN });
    expect(response.status).toBe(200);
  });
});

describe("CSRF (PRD §11.2)", () => {
  it("refuses a state-changing request from a foreign origin", async () => {
    for (const method of ["POST", "PUT", "PATCH", "DELETE"]) {
      const response = await call("/api/auth/login", { method, origin: "https://evil.example" });

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({ error: { code: "FORBIDDEN" } });
    }
  });

  it("refuses the literal null origin a sandboxed iframe sends", async () => {
    expect((await call("/api/auth/login", { method: "POST", origin: "null" })).status).toBe(403);
  });

  it("accepts a same-origin mutation", async () => {
    expect((await call("/api/auth/login", { method: "POST", origin: ORIGIN })).status).toBe(200);
  });

  it("accepts X-Forwarded-Host, because NPM may not preserve Host (PRD §12.4)", async () => {
    const response = await call("/api/auth/login", {
      method: "POST",
      origin: "https://downloads.labsy.in",
      headers: { host: "10.0.0.5:3000", "x-forwarded-host": "downloads.labsy.in" },
    });
    expect(response.status).toBe(200);
  });

  it("allows a missing Origin — that is a CLI client, and CSRF needs a browser", async () => {
    expect((await call("/api/auth/login", { method: "POST" })).status).toBe(200);
  });

  it("does not apply to reads", async () => {
    for (const method of ["GET", "HEAD"]) {
      const response = await call("/api/tools", { method, origin: "https://evil.example" });
      expect(response.status).toBe(200);
    }
  });

  it("refuses before checking the session, so a valid cookie does not excuse it", async () => {
    const response = await call("/api/admin/tools", {
      method: "DELETE",
      origin: "https://evil.example",
      session: sealed,
    });
    expect(response.status).toBe(403);
  });
});

describe("security headers (PRD §11.2)", () => {
  const paths = ["/", "/admin/login", "/api/tools", "/admin"];

  it("are present on pages, APIs, redirects and refusals alike", async () => {
    for (const path of paths) {
      const headers = (await call(path)).headers;

      expect(headers.get("x-content-type-options")).toBe("nosniff");
      expect(headers.get("x-frame-options")).toBe("DENY");
      expect(headers.get("referrer-policy")).toBe("same-origin");
      expect(headers.get("content-security-policy")).toBeTruthy();
    }
  });

  it("ship a CSP with no unsafe-eval and no unsafe-inline script source", async () => {
    // NODE_ENV is "test" under vitest, so this is the production branch.
    const csp = (await call("/")).headers.get("content-security-policy")!;

    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toMatch(/script-src [^;]*'nonce-[^']+' 'strict-dynamic'/);
    expect(csp).not.toMatch(/script-src [^;]*unsafe-inline/);
    expect(csp).toContain("object-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("font-src 'self'"); // the self-hosted Inter/JetBrains files
  });

  it("mint a fresh nonce per request", async () => {
    const first = (await call("/")).headers.get("content-security-policy")!;
    const second = (await call("/")).headers.get("content-security-policy")!;

    expect(nonceOf(first)).not.toBe(nonceOf(second));
  });

  it("hand the same nonce to the renderer, or hydration breaks silently", async () => {
    const response = await call("/");

    // `NextResponse.next({ request })` echoes the rewritten request headers back
    // under this internal key — the only way to observe them from a test.
    const forwarded = response.headers.get("x-middleware-override-headers");
    expect(forwarded).toContain("x-nonce");
    expect(response.headers.get("x-middleware-request-x-nonce")).toBe(
      nonceOf(response.headers.get("content-security-policy")!),
    );
  });
});

function nonceOf(csp: string): string {
  return /'nonce-([^']+)'/.exec(csp)?.[1] ?? "";
}
