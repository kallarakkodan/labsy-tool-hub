import { apiError, apiFailure, notFound, validationFailed } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import {
  ChunkSizeMismatchError,
  MissingChunkError,
  SizeMismatchError,
  concatenateUpload,
  removeUploadDir,
  resolveUploadDestination,
  toRelative,
  verifyUploadParts,
} from "@/lib/storage";
import { uploadCompleteSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 0; // concatenating and hashing an 8 GB file is not instant

/*
 * POST /api/uploads/[id]/complete (PRD §9.5, CONTEXT §7.3, issue 30)
 *
 * Where correctness is proved: every part present and correctly sized, one
 * read of the assembled bytes computing SHA-256 as it goes (not a second pass
 * once the file exists), and the file only lands at its real destination once
 * the total actually matches what the client claimed at init. All of that
 * lives in `lib/storage.ts` — this handler is the state machine around it:
 * load the row, run the pipeline, persist the result, clean up.
 */
export async function POST(request: Request, context: RouteContext<"/api/uploads/[id]/complete">) {
  const { id } = await context.params;

  const parsed = uploadCompleteSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    const upload = await prisma.upload.findUnique({ where: { id } });
    if (upload === null) return notFound("No upload with that id.");
    if (upload.status !== "pending") {
      return apiError("CONFLICT", `This upload is ${upload.status}, not ready to complete.`, 409);
    }

    await verifyUploadParts(upload.tempDir, upload.totalChunks, upload.chunkSize, upload.totalSize);

    const destination = await resolveUploadDestination(
      upload.fileName,
      parsed.data.targetSubdir,
      parsed.data.overwrite ?? false,
    );

    const { size, checksum } = await concatenateUpload(
      upload.tempDir,
      upload.totalChunks,
      destination.absolutePath,
      upload.totalSize,
    );

    // Only now — the assembled file is verified and in place — is the temp
    // directory expendable.
    await removeUploadDir(upload.tempDir);

    const relativePath = await toRelative(destination.absolutePath);
    await prisma.upload.update({
      where: { id },
      data: { status: "completed", finalPath: relativePath, checksum },
    });

    await recordAudit("upload.complete", {
      targetId: id,
      detail: { fileName: destination.fileName, path: relativePath, size: size.toString(), checksum },
    });

    return Response.json({
      filePath: relativePath,
      fileName: destination.fileName,
      fileSize: size.toString(),
      checksum,
    });
  } catch (error) {
    if (error instanceof MissingChunkError) {
      return apiError("CONFLICT", error.message, 409);
    }
    if (error instanceof ChunkSizeMismatchError || error instanceof SizeMismatchError) {
      return apiError("SIZE_MISMATCH", error.message, 409);
    }
    return apiFailure(error, "POST /api/uploads/[id]/complete");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
