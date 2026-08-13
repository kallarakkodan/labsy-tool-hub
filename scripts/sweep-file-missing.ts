import { config as loadEnv } from "dotenv";
import { createPrismaClient } from "../src/lib/db";
import { sweepFileMissing } from "../src/lib/file-missing-sweep";

/*
 * `pnpm sweep:file-missing` — the weekly `fileMissing` integrity sweep
 * (PRD §11.3, issue 33). Run by a systemd timer in production (unit shipped
 * in issue 34's deploy/); safe to run by hand any time, since it never
 * touches disk beyond a `stat` per registered tool.
 */

loadEnv({ path: [".env.local", ".env"], quiet: true });

async function main(): Promise<void> {
  const prisma = createPrismaClient();
  const startedAt = Date.now();

  try {
    const summary = await sweepFileMissing(prisma);
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    console.log(
      `[sweep] checked ${summary.checked} tool${summary.checked === 1 ? "" : "s"} in ${seconds}s — ` +
        `${summary.newlyMissing} newly missing, ${summary.recovered} recovered`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error: unknown) => {
  console.error("[sweep] failed:", error);
  process.exit(1);
});
