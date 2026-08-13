/**
 * The shapes that cross the wire.
 *
 * These are deliberately *not* the Prisma model types. `Tool.fileSize` is a
 * `BigInt`, which `JSON.stringify` refuses to serialise, so everything leaving
 * an API handler goes through `serializeTool()` and arrives client-side with
 * `fileSize` as a **string**. Naming the serialised shape separately is what
 * stops a component from being typed against a field it can never receive.
 *
 * Types are unprefixed (CONTEXT §6): `Tool`, not `ITool`.
 */

export type ToolVisibility = "public" | "admin";

export interface SerializedTool {
  id: string;
  slug: string;
  name: string;
  description: string;
  category: string;
  version: string;

  // No `filePath`. CONTEXT §2 item 5 forbids sending a host path to the client,
  // and the public shape simply has nowhere to put one — see SerializedAdminTool.
  fileName: string;
  /** Bytes, as a decimal string. `Number()` it only for formatting. */
  fileSize: string;
  mimeType: string;
  checksum: string | null;
  checksumAt: string | null;

  iconUrl: string | null;
  notes: string | null;

  published: boolean;
  visibility: ToolVisibility;
  featured: boolean;
  fileMissing: boolean;

  downloadCount: number;
  lastDownloadAt: string | null;

  createdAt: string;
  updatedAt: string;
}

/**
 * What the admin dashboard receives. The one extra field is the file path, and it
 * is **relative to STORAGE_ROOT** — the admin table's Path column shows that, not
 * the absolute host path, so the storage root stays relocatable.
 */
export interface SerializedAdminTool extends SerializedTool {
  filePath: string;
}

export type UploadStatus = "pending" | "completed" | "aborted";

export interface SerializedUpload {
  id: string;
  fileName: string;
  /** Bytes, as a decimal string — same BigInt boundary as `SerializedTool.fileSize`. */
  totalSize: string;
  chunkSize: number;
  totalChunks: number;
  received: number[];
  status: UploadStatus;
  createdAt: string;
  expiresAt: string;
}

/** `{ error: { code, message } }` — the envelope every failing handler returns (PRD §9). */
export interface ApiErrorBody {
  error: {
    code: string;
    message: string;
  };
}

/** `GET /api/admin/tools/[id]/delete-eligibility` (PRD §8.2, issue 25). */
export interface DeleteEligibility {
  eligible: boolean;
  reason: string | null;
}
