import { randomUUID } from "node:crypto";
import checkDiskSpace from "check-disk-space";
import { apiError, apiFailure, rateLimited, validationFailed } from "@/lib/api";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sessionKey } from "@/lib/request";
import { createUploadDir, getRoot } from "@/lib/storage";
import { uploadInitSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/uploads/init (PRD §9.5, issue 28)
 *
 * Reserves an upload: a rate-limited, free-space-checked `Upload` row plus its
 * temp directory. Nothing about a chunk's bytes happens here — that is issue
 * 29's `PUT .../chunk`.
 *
 * Order matters: the temp directory is created *before* the database row, with
 * an id this route generates itself. A row that outlives its directory is a
 * dangling reference every later read has to handle; a directory that outlives
 * its row is an empty folder the janitor's next full sweep of expired rows will
 * simply never be asked to touch — inert, not dangerous (PRD §16 D4's own
 * "costs a few pounds of storage" reasoning, applied to bytes instead of a
 * catalogue row).
 */

/**
 * Concatenation transiently needs both the chunk parts and the assembled file
 * (PRD §9.5), so the preflight demands headroom for both, plus a margin.
 */
const FREE_SPACE_MULTIPLIER = 2.1;

export async function POST(request: Request) {
  const gate = consumeRateLimit("uploadInit", sessionKey(request));
  if (!gate.allowed) return rateLimited(gate.retryAfter);

  const parsed = uploadInitSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  const { fileName, totalSize } = parsed.data;

  try {
    const { free } = await checkDiskSpace(await getRoot());
    const required = Number(totalSize) * FREE_SPACE_MULTIPLIER;
    if (required > free) {
      return apiError(
        "INSUFFICIENT_STORAGE",
        "Not enough free space on the server to accept this upload.",
        507,
      );
    }

    const env = getEnv();
    const totalChunks = Math.ceil(Number(totalSize) / env.CHUNK_SIZE);
    const expiresAt = new Date(Date.now() + env.UPLOAD_TTL_HOURS * 3_600_000);

    const uploadId = randomUUID();
    const tempDir = await createUploadDir(uploadId);

    await prisma.upload.create({
      data: {
        id: uploadId,
        fileName,
        totalSize,
        chunkSize: env.CHUNK_SIZE,
        totalChunks,
        tempDir,
        status: "pending",
        expiresAt,
      },
    });

    return Response.json(
      { uploadId, chunkSize: env.CHUNK_SIZE, totalChunks, received: [] },
      { status: 201 },
    );
  } catch (error) {
    return apiFailure(error, "POST /api/uploads/init");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
