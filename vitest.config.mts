import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    // Mirrors the `@/*` path in tsconfig.json. Without it, any test that reaches
    // a module using the alias fails to resolve at import time.
    alias: {
      "@": resolve(import.meta.dirname, "src"),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    // Suites that push a schema with the Prisma CLI need more than the default.
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
