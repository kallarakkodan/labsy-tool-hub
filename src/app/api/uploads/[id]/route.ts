import { apiFailure, notFound } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseReceived } from "@/lib/serialize";
import { removeUploadDir } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * /api/uploads/[id] (PRD §9.5, issue 28)
 *
 * `GET` is the resume query a reloaded page uses to find out which chunks it
 * already has; `DELETE` is an explicit cancel. Both are narrow reads/writes of
 * one row plus the directory it names — the chunk protocol itself lives in
 * issue 29's `.../chunk` and issue 30's `.../complete`.
 */

export async function GET(_request: Request, context: RouteContext<"/api/uploads/[id]">) {
  try {
    const upload = await prisma.upload.findUnique({ where: { id: (await context.params).id } });
    if (upload === null) return notFound("No upload with that id.");

    return Response.json({
      uploadId: upload.id,
      received: parseReceived(upload.received),
      totalChunks: upload.totalChunks,
      status: upload.status,
    });
  } catch (error) {
    return apiFailure(error, "GET /api/uploads/[id]");
  }
}

/** Cancel: the temp directory and its row both go, regardless of how far the upload got. */
export async function DELETE(_request: Request, context: RouteContext<"/api/uploads/[id]">) {
  try {
    const upload = await prisma.upload.findUnique({ where: { id: (await context.params).id } });
    if (upload === null) return notFound("No upload with that id.");

    await removeUploadDir(upload.tempDir);
    await prisma.upload.delete({ where: { id: upload.id } });

    return new Response(null, { status: 204 });
  } catch (error) {
    return apiFailure(error, "DELETE /api/uploads/[id]");
  }
}
