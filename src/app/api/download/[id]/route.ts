import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { apiError, apiFailure, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { contentDisposition, etagFor, parseRange } from "@/lib/http";
import { PathError, resolveStoredPath, toRelative } from "@/lib/storage";
import { findTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/download/[id] (PRD §9.4, CONTEXT §7.2)
 *
 * The whole card is an `<a download>` pointing here, so this has to behave for
 * browsers, `curl -C -`, and download managers alike.
 */
export async function GET(request: Request, context: RouteContext<"/api/download/[id]">) {
  return handle(request, context, "GET");
}

/** Identical headers, no body (PRD §9.4). Download managers probe with this. */
export async function HEAD(request: Request, context: RouteContext<"/api/download/[id]">) {
  return handle(request, context, "HEAD");
}

async function handle(
  request: Request,
  context: RouteContext<"/api/download/[id]">,
  method: "GET" | "HEAD",
): Promise<Response> {
  const { id } = await context.params;

  try {
    // 1. Scope first. Missing, draft, or internal all answer 404 — never 403,
    //    which would confirm the tool exists (PRD §9.4 step 1).
    const tool = await findTool(id, await isAdmin());
    if (tool === null) return notFound("No such tool.");

    // 2. Re-validate the stored path. The database is not a trusted source of
    //    paths (PRD §9.4 step 2) — defence in depth behind lib/storage.ts.
    let absolute: string;
    try {
      absolute = await resolveStoredPath(tool.filePath);
    } catch (error) {
      if (error instanceof PathError) return await markMissing(tool.id, tool.fileMissing);
      throw error;
    }

    // 3. stat. Gone from disk is 410, not 404: the catalogue entry is real, the
    //    bytes are not, and the card should say Unavailable rather than vanish.
    const stats = await stat(absolute).catch(() => null);
    if (stats === null || !stats.isFile()) return await markMissing(tool.id, tool.fileMissing);

    // A file that reappeared clears the flag.
    if (tool.fileMissing) void clearMissing(tool.id);

    // 4. Fire and forget. Never block the response on a counter (step 4).
    void bumpDownloadCount(tool.id);

    // 5. Headers. Content-Length and ETag come from the stat, never from
    //    Tool.fileSize — the DB column is a display snapshot (ADR-0002).
    const size = stats.size;
    const headers = new Headers({
      "Content-Type": tool.mimeType,
      "Content-Disposition": contentDisposition(tool.fileName),
      "Accept-Ranges": "bytes",
      "Cache-Control": "private, max-age=0, must-revalidate",
      ETag: etagFor(size, stats.mtimeMs),
      "Last-Modified": stats.mtime.toUTCString(),
    });

    // 7. Optional: let the proxy serve the bytes (PRD §12.4). Off by default.
    const env = getEnv();
    if (env.USE_X_ACCEL) {
      const relative = await toRelative(absolute);
      headers.set("Content-Length", String(size));
      // encodeURI, not encodeURIComponent: the separators must survive.
      headers.set("X-Accel-Redirect", `${env.X_ACCEL_PREFIX}/${encodeURI(relative)}`);
      return new Response(null, { status: 200, headers });
    }

    // 6. Default: Node streams, with Range.
    const range = parseRange(request.headers.get("range"), size);

    if (range.kind === "unsatisfiable") {
      headers.set("Content-Range", `bytes */${size}`);
      return apiError("VALIDATION_FAILED", "Requested range is not satisfiable.", 416, headers);
    }

    const start = range.kind === "satisfiable" ? range.range.start : 0;
    const end = range.kind === "satisfiable" ? range.range.end : size - 1;
    const length = size === 0 ? 0 : end - start + 1;

    headers.set("Content-Length", String(length));
    if (range.kind === "satisfiable") {
      headers.set("Content-Range", `bytes ${start}-${end}/${size}`);
    }

    const status = range.kind === "satisfiable" ? 206 : 200;
    if (method === "HEAD" || length === 0) return new Response(null, { status, headers });

    return new Response(streamFile(absolute, start, end, request.signal), { status, headers });
  } catch (error) {
    return apiFailure(error, "GET /api/download/[id]");
  }
}

/**
 * A cancelled download must not leak a file descriptor (PRD §14). Node does not
 * destroy the underlying stream when the web stream is cancelled, so the abort
 * signal is wired up explicitly — 20 abandoned downloads is 20 held fds.
 */
function streamFile(absolute: string, start: number, end: number, signal: AbortSignal): ReadableStream {
  const nodeStream = createReadStream(absolute, { start, end });

  const abort = () => nodeStream.destroy();
  if (signal.aborted) abort();
  else signal.addEventListener("abort", abort, { once: true });

  nodeStream.once("close", () => signal.removeEventListener("abort", abort));

  return Readable.toWeb(nodeStream) as ReadableStream;
}

async function markMissing(id: string, alreadyFlagged: boolean): Promise<Response> {
  if (!alreadyFlagged) {
    await prisma.tool.update({ where: { id }, data: { fileMissing: true } }).catch(() => {});
  }
  return apiError(
    "FILE_MISSING",
    "This file is no longer on the server. It has been flagged for an administrator.",
    410,
  );
}

function clearMissing(id: string): void {
  void prisma.tool.update({ where: { id }, data: { fileMissing: false } }).catch(() => {});
}

function bumpDownloadCount(id: string): void {
  void prisma.tool
    .update({
      where: { id },
      data: { downloadCount: { increment: 1 }, lastDownloadAt: new Date() },
    })
    .catch((error: unknown) => {
      // A failed counter must never surface to the person downloading.
      console.error("[download] failed to bump counter", error);
    });
}
