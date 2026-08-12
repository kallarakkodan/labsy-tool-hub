import type { Tool, Upload } from "@/generated/prisma/client";
import type {
  SerializedAdminTool,
  SerializedTool,
  SerializedUpload,
  ToolVisibility,
  UploadStatus,
} from "@/types";

/*
 * The BigInt boundary.
 *
 * `JSON.stringify(1n)` throws `TypeError: Do not know how to serialize a BigInt`,
 * and `Tool.fileSize` is a BigInt on every row. PRD §6 calls this the most likely
 * source of a runtime crash in this codebase, and it is: nothing warns you, the
 * throw happens inside the framework's response serialisation, and it only fires
 * on the paths that actually return a tool.
 *
 * Every tool leaving a handler goes through here. Note there is deliberately no
 * `BigInt.prototype.toJSON` polyfill — a global patch would hide the boundary and
 * silently rescue code that should have been routed through this module.
 */

export function serializeTool(tool: Tool): SerializedTool {
  return {
    id: tool.id,
    slug: tool.slug,
    name: tool.name,
    description: tool.description,
    category: tool.category,
    version: tool.version,

    fileName: tool.fileName,
    fileSize: tool.fileSize.toString(),
    mimeType: tool.mimeType,
    checksum: tool.checksum,
    checksumAt: tool.checksumAt?.toISOString() ?? null,

    iconUrl: tool.iconUrl,
    notes: tool.notes,

    published: tool.published,
    visibility: tool.visibility as ToolVisibility,
    featured: tool.featured,
    fileMissing: tool.fileMissing,

    downloadCount: tool.downloadCount,
    lastDownloadAt: tool.lastDownloadAt?.toISOString() ?? null,

    createdAt: tool.createdAt.toISOString(),
    updatedAt: tool.updatedAt.toISOString(),
  };
}

/**
 * The admin shape. `relativePath` must already be relative to STORAGE_ROOT —
 * `toRelative()` in `lib/storage.ts` is what produces it. Taking it as an
 * argument rather than reading `tool.filePath` is the point: passing the raw
 * absolute path would be an obvious mistake at the call site instead of a
 * silent leak in here.
 */
export function serializeAdminTool(tool: Tool, relativePath: string): SerializedAdminTool {
  return { ...serializeTool(tool), filePath: relativePath };
}

export function serializeUpload(upload: Upload): SerializedUpload {
  return {
    id: upload.id,
    fileName: upload.fileName,
    totalSize: upload.totalSize.toString(),
    chunkSize: upload.chunkSize,
    totalChunks: upload.totalChunks,
    received: parseReceived(upload.received),
    status: upload.status as UploadStatus,
    createdAt: upload.createdAt.toISOString(),
    expiresAt: upload.expiresAt.toISOString(),
  };
}

/**
 * `Upload.received` is a JSON array in a TEXT column. A malformed value should
 * degrade to "no chunks received" — the client then re-uploads rather than the
 * resume query 500-ing, which is the recoverable failure of the two.
 */
export function parseReceived(received: string): number[] {
  try {
    const parsed: unknown = JSON.parse(received);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((n): n is number => Number.isInteger(n));
  } catch {
    return [];
  }
}
