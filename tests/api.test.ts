import { describe, expect, it, vi } from "vitest";
import { apiError, apiFailure, notFound, unauthorized, validationFailed } from "../src/lib/api";
import { PathError } from "../src/lib/storage";

describe("apiError", () => {
  it("produces the PRD §9 envelope", async () => {
    const response = apiError("FILE_MISSING", "The file is no longer on disk.", 410);

    expect(response.status).toBe(410);
    expect(await response.json()).toEqual({
      error: { code: "FILE_MISSING", message: "The file is no longer on disk." },
    });
  });

  it("passes headers through, which 429 needs for Retry-After", async () => {
    const response = apiError("RATE_LIMITED", "Too many attempts.", 429, { "Retry-After": "900" });
    expect(response.headers.get("Retry-After")).toBe("900");
  });
});

describe("apiFailure", () => {
  it("maps each PathError code to the status PRD §9.3 specifies", async () => {
    const cases = [
      ["INVALID_PATH", 400],
      ["PATH_OUTSIDE_ROOT", 403],
      ["NOT_FOUND", 404],
      ["NOT_A_DIRECTORY", 400],
      ["EACCES", 403],
    ] as const;

    for (const [code, status] of cases) {
      const response = apiFailure(new PathError(code, `message for ${code}`), "test");
      expect(response.status).toBe(status);
      expect((await response.json()).error.code).toBe(code);
    }
  });

  it("never leaks a non-PathError message to the client", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const leaky = new Error("ENOENT: no such file, open '/srv/downloads/secret/plans.iso'");
      const response = apiFailure(leaky, "download");
      const text = await response.text();

      expect(response.status).toBe(500);
      expect(text).not.toContain("/srv/downloads");
      expect(text).not.toContain("ENOENT");
      // It is logged server-side, though — losing it entirely is its own problem.
      expect(spy).toHaveBeenCalledWith("[download]", leaky);
    } finally {
      spy.mockRestore();
    }
  });
});

describe("shorthand responses", () => {
  it("unauthorized is 401 JSON, not an HTML redirect", async () => {
    const response = unauthorized();
    expect(response.status).toBe(401);
    expect(response.headers.get("content-type")).toContain("application/json");
    expect((await response.json()).error.code).toBe("UNAUTHORIZED");
  });

  it("notFound is 404 — the answer for an out-of-scope tool, never 403", async () => {
    expect(notFound().status).toBe(404);
  });

  it("validationFailed names the offending fields", async () => {
    const response = validationFailed([
      { path: ["name"], message: "at least 2 characters" },
      { path: ["file", "relativePath"], message: "select a file" },
    ]);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.error.code).toBe("VALIDATION_FAILED");
    expect(body.error.message).toContain("name: at least 2 characters");
    expect(body.error.message).toContain("file.relativePath: select a file");
  });
});
