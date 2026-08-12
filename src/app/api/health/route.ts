import fs from "node:fs/promises";
import { getEnv } from "@/lib/env";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/health (PRD §9.1)
 *
 * Polled every 30s by the header's LAN status dot (PRD §7.1) and the first thing
 * to check after a deploy.
 *
 * No auth, no DB writes. It returns 200 with `ok: false` on a degraded check
 * rather than a 5xx: the dot needs to tell "reachable but unhealthy" apart from
 * "unreachable", and a non-200 collapses both into the same red.
 */
export async function GET() {
  const env = getEnv();

  const [dbOk, toolCount] = await checkDatabase();
  const storageRootWritable = await checkStorageRoot(env.STORAGE_ROOT);

  return Response.json(
    {
      ok: dbOk && storageRootWritable,
      version: env.NEXT_PUBLIC_APP_VERSION,
      uptime: Math.round(process.uptime()),
      storageRootWritable,
      dbOk,
      toolCount,
    },
    {
      // A cached health check is worse than none.
      headers: { "Cache-Control": "no-store" },
    },
  );
}

async function checkDatabase(): Promise<[ok: boolean, toolCount: number | null]> {
  try {
    return [true, await prisma.tool.count()];
  } catch (error) {
    console.error("[health] database check failed", error);
    return [false, null];
  }
}

/**
 * Writable, not merely readable: uploads land under the storage root, and a
 * read-only mount is a failure the dot should surface before someone discovers
 * it eight gigabytes into an upload.
 *
 * Reports a boolean and never the path — CONTEXT §2 item 5, and this endpoint is
 * unauthenticated.
 */
async function checkStorageRoot(root: string): Promise<boolean> {
  try {
    await fs.access(root, fs.constants.R_OK | fs.constants.W_OK | fs.constants.X_OK);
    return true;
  } catch (error) {
    console.error("[health] storage root check failed", error);
    return false;
  }
}
