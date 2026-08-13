import { describe, expect, it } from "vitest";
import { UNKNOWN_IP, UNKNOWN_SESSION, clientIp, safeNextPath, sessionKey } from "../src/lib/request";

/*
 * CONTEXT §2 item 6. The failure this guards is quiet: a limiter keyed on an
 * unvalidated header still *runs*, it just never limits anything, because every
 * forged variation lands in its own bucket.
 */

function withHeaders(headers: Record<string, string>): Request {
  return new Request("http://hub.labsy.internal/api/auth/login", { headers });
}

describe("clientIp", () => {
  it("takes the first X-Forwarded-For entry, not the last", () => {
    // browser → NPM → Node leaves the real client leftmost and the proxies after it.
    const request = withHeaders({ "x-forwarded-for": "10.20.30.40, 172.18.0.2, 127.0.0.1" });
    expect(clientIp(request)).toBe("10.20.30.40");
  });

  it("trims surrounding whitespace", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "  10.20.30.40 , 172.18.0.2" }))).toBe("10.20.30.40");
  });

  it("accepts a bare IPv6 address", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "2001:db8::1" }))).toBe("2001:db8::1");
  });

  it("folds IPv6 case, so one client is one bucket", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "2001:DB8::1" }))).toBe("2001:db8::1");
  });

  it("strips the port from both the IPv4 and the bracketed IPv6 form", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "10.20.30.40:51234" }))).toBe("10.20.30.40");
    expect(clientIp(withHeaders({ "x-forwarded-for": "[2001:db8::1]:8080" }))).toBe("2001:db8::1");
  });

  it("strips an IPv6 zone, which names an interface on someone else's host", () => {
    expect(clientIp(withHeaders({ "x-forwarded-for": "fe80::1%eth0" }))).toBe("fe80::1");
  });

  it("rejects a non-IP and falls back to X-Real-IP", () => {
    const request = withHeaders({ "x-forwarded-for": "not-an-ip", "x-real-ip": "10.20.30.41" });
    expect(clientIp(request)).toBe("10.20.30.41");
  });

  it("rejects the header injection shapes an attacker would try", () => {
    for (const forged of ["not-an-ip", "", "   ", "999.999.999.999", "10.20.30.40; DROP", "<script>"]) {
      expect(clientIp(withHeaders({ "x-forwarded-for": forged }))).toBe(UNKNOWN_IP);
    }
  });

  it("falls back to X-Real-IP when X-Forwarded-For is absent", () => {
    expect(clientIp(withHeaders({ "x-real-ip": "10.20.30.42" }))).toBe("10.20.30.42");
  });

  it("returns the sentinel when there is nothing usable at all", () => {
    expect(clientIp(withHeaders({}))).toBe(UNKNOWN_IP);
    expect(clientIp(withHeaders({ "x-forwarded-for": "nope", "x-real-ip": "also-nope" }))).toBe(UNKNOWN_IP);
  });
});

describe("sessionKey", () => {
  it("reads the labsy_session cookie's value", () => {
    expect(sessionKey(withHeaders({ cookie: "labsy_session=abc123" }))).toBe("abc123");
  });

  it("finds it among other cookies, in either position", () => {
    expect(sessionKey(withHeaders({ cookie: "theme=dark; labsy_session=abc123" }))).toBe("abc123");
    expect(sessionKey(withHeaders({ cookie: "labsy_session=abc123; theme=dark" }))).toBe("abc123");
  });

  it("does not match a cookie whose name merely contains labsy_session", () => {
    expect(sessionKey(withHeaders({ cookie: "not_labsy_session=abc123" }))).toBe(UNKNOWN_SESSION);
  });

  it("falls back to the sentinel with no cookie header, or none matching", () => {
    expect(sessionKey(withHeaders({}))).toBe(UNKNOWN_SESSION);
    expect(sessionKey(withHeaders({ cookie: "theme=dark" }))).toBe(UNKNOWN_SESSION);
  });
});

describe("safeNextPath", () => {
  it("keeps a relative /admin path, including its query", () => {
    expect(safeNextPath("/admin")).toBe("/admin");
    expect(safeNextPath("/admin/tools")).toBe("/admin/tools");
    expect(safeNextPath("/admin?category=OS%20Images")).toBe("/admin?category=OS%20Images");
  });

  it("refuses an absolute URL, however it is dressed up", () => {
    for (const hostile of [
      "https://evil.example/admin",
      "http://evil.example/admin",
      "//evil.example/admin",
      "/\\evil.example/admin",
      "javascript:alert(1)",
    ]) {
      expect(safeNextPath(hostile)).toBe("/admin");
    }
  });

  it("refuses a path outside /admin, and the prefix that only looks like it", () => {
    expect(safeNextPath("/")).toBe("/admin");
    expect(safeNextPath("/api/download/1")).toBe("/admin");
    expect(safeNextPath("/administrators")).toBe("/admin");
    expect(safeNextPath("/adminsomething")).toBe("/admin");
  });

  it("refuses control characters, which are header-injection material", () => {
    expect(safeNextPath("/admin\r\nSet-Cookie: x=1")).toBe("/admin");
    expect(safeNextPath("/admin/tools\u0000")).toBe("/admin");
    expect(safeNextPath("/admin/tools\u0009")).toBe("/admin");
  });

  it("handles a missing value", () => {
    expect(safeNextPath(null)).toBe("/admin");
    expect(safeNextPath(undefined)).toBe("/admin");
    expect(safeNextPath("")).toBe("/admin");
  });
});
