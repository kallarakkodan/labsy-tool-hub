import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

/*
 * Prisma 7 moved the datasource URL out of schema.prisma and into this file, and
 * it does not read .env files on its own.
 *
 * Next loads .env.local ahead of .env; the Prisma CLI has no such convention, so
 * the order is spelled out here. Without it, `pnpm db:push` would write to a
 * different database than the app reads — silently.
 *
 * This is CLI-time configuration and sits outside src/, so it does not break the
 * rule that lib/env.ts is the only place src/ reads process.env.
 */
loadEnv({ path: [".env.local", ".env"], quiet: true });

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
  },
  datasource: {
    url: process.env["DATABASE_URL"],
  },
});
