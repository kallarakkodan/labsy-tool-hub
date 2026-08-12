import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const pkg = JSON.parse(readFileSync(resolve(root, "package.json"), "utf8"));

describe("scaffold", () => {
  it("pins the Node major the deploy target runs", () => {
    expect(readFileSync(resolve(root, ".nvmrc"), "utf8").trim()).toBe("26.5.0");
    expect(pkg.engines.node).toBe(">=26");
  });

  it("exposes every command CONTEXT §4 documents", () => {
    const documented = [
      "dev", "build", "start", "typecheck", "lint", "test", "test:security",
      "db:push", "db:migrate", "db:studio", "db:seed", "db:seed:clear", "gen:hash",
    ];
    expect(Object.keys(pkg.scripts)).toEqual(expect.arrayContaining(documented));
  });

  it("runs typecheck through next typegen, or a clean checkout fails on generated route types", () => {
    expect(pkg.scripts.typecheck).toContain("next typegen");
  });
});
