import { apiError, apiFailure, notFound, validationFailed } from "@/lib/api";
import { prisma } from "@/lib/db";
import { parseReceived } from "@/lib/serialize";
import { writeUploadChunk } from "@/lib/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 0; // a 16 MiB chunk over Wi-Fi is slow (CONTEXT §7.3)

/*
 * PUT /api/uploads/[id]/chunk?index=N (PRD §9.5, CONTEXT §7.3, issue 29)
 *
 * The hot path — the one place a mistake turns a 16 MiB chunk into 16 MiB of
 * resident memory. `writeUploadChunk` streams the body straight to disk; there
 * is no `await request.arrayBuffer()` anywhere in this file (CONTEXT §2 item 3).
 *
 * Chunks may arrive out of order, and the same index may arrive twice (a
 * client retry after a dropped response) — both are handled, not assumed away.
 */

/*
 * Serializes the read-modify-write of one upload's `received` column so two
 * chunks landing in the same moment cannot both read the same array and each
 * write back a version missing the other's index. Scoped per upload id, not
 * one global lock, so unrelated uploads never wait on each other — a simple
 * promise-chain mutex is enough because this is a single Node process
 * (`lib/rate-limit.ts` makes the same call for the same reason).
 */
const queues = new Map<string, Promise<unknown>>();

function serialized<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const previous = queues.get(key) ?? Promise.resolve();
  const next = previous.then(fn, fn);
  queues.set(key, next.catch(() => undefined));
  return next;
}

export async function PUT(request: Request, context: RouteContext<"/api/uploads/[id]/chunk">) {
  const { id } = await context.params;
  const indexParam = new URL(request.url).searchParams.get("index");
  const index = indexParam === null ? NaN : Number(indexParam);

  try {
    const upload = await prisma.upload.findUnique({ where: { id } });
    if (upload === null) return notFound("No upload with that id.");

    if (!Number.isInteger(index) || index < 0 || index >= upload.totalChunks) {
      return validationFailed([
        { path: ["index"], message: `must be an integer in [0, ${upload.totalChunks})` },
      ]);
    }
    if (upload.status !== "pending") {
      return apiError("CONFLICT", `This upload is ${upload.status}, not accepting chunks.`, 409);
    }
    if (upload.expiresAt.getTime() <= Date.now()) {
      return apiError("CONFLICT", "This upload has expired.", 409);
    }
    if (request.body === null) {
      return validationFailed([{ path: ["body"], message: "A chunk requires a request body." }]);
    }

    await writeUploadChunk(upload.tempDir, index, request.body);

    const count = await serialized(id, async () => {
      const current = await prisma.upload.findUniqueOrThrow({ where: { id } });
      const received = new Set(parseReceived(current.received));
      received.add(index);
      const sorted = [...received].sort((a, b) => a - b);
      await prisma.upload.update({ where: { id }, data: { received: JSON.stringify(sorted) } });
      return sorted.length;
    });

    return Response.json({ received: index, count });
  } catch (error) {
    return apiFailure(error, "PUT /api/uploads/[id]/chunk");
  }
}
