import { apiFailure, notFound } from "@/lib/api";
import { findToolByIdOrSlug } from "@/lib/admin-tools";
import { enqueueChecksum } from "@/lib/checksum";
import { prisma } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/admin/tools/[id]/checksum (PRD §9.2, issue 32)
 *
 * Enqueue or recompute. `checksum`/`checksumAt` are cleared immediately, not
 * left showing the old value until the queue gets to it — the UI's
 * "Computing…" state is keyed on `checksum === null`, and a stale hash sitting
 * there while a genuinely different file gets re-hashed underneath it would be
 * actively misleading (issue 32's "watch out").
 */
export async function POST(_request: Request, context: RouteContext<"/api/admin/tools/[id]/checksum">) {
  try {
    const tool = await findToolByIdOrSlug((await context.params).id);
    if (tool === null) return notFound("No tool with that id or slug.");

    await prisma.tool.update({ where: { id: tool.id }, data: { checksum: null, checksumAt: null } });
    enqueueChecksum(tool.id, tool.filePath);

    return Response.json({ enqueued: true });
  } catch (error) {
    return apiFailure(error, "POST /api/admin/tools/[id]/checksum");
  }
}
