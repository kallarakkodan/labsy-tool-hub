import type { PrismaClient } from "@/generated/prisma/client";
import { prisma as defaultPrisma } from "@/lib/db";
import { fileStillExists } from "@/lib/storage";

/*
 * The weekly integrity sweep (PRD §11.3, §13 row 6, §16 D4, issue 33).
 *
 * Read-only, deliberately: it only ever sets or clears `Tool.fileMissing`,
 * never touches a byte on disk, and never deletes a `Tool` row. D4 is explicit
 * that a missing artifact is a candidate for a human to look at, not something
 * a scheduled job gets to act on (PRD §14: "No scheduled job anywhere in this
 * repo removes a file from STORAGE_ROOT" — the same rule the upload janitor
 * follows for a different reason).
 *
 * One `stat` at a time, not `Promise.all` over the whole catalogue: a burst of
 * thousands of concurrent stats during a download window is exactly the kind
 * of avoidable contention PRD §12.8 sizes the disk against.
 */

export interface SweepSummary {
  checked: number;
  newlyMissing: number;
  recovered: number;
}

export async function sweepFileMissing(client: PrismaClient = defaultPrisma): Promise<SweepSummary> {
  const tools = await client.tool.findMany({ select: { id: true, filePath: true, fileMissing: true } });

  let newlyMissing = 0;
  let recovered = 0;

  for (const tool of tools) {
    const exists = await fileStillExists(tool.filePath);

    if (!exists && !tool.fileMissing) {
      await client.tool.update({ where: { id: tool.id }, data: { fileMissing: true } });
      newlyMissing += 1;
    } else if (exists && tool.fileMissing) {
      await client.tool.update({ where: { id: tool.id }, data: { fileMissing: false } });
      recovered += 1;
    }
  }

  return { checked: tools.length, newlyMissing, recovered };
}
