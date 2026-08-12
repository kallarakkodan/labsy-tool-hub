import type { Prisma, Tool } from "@/generated/prisma/client";
import { recordAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { getEnv } from "@/lib/env";
import { mimeTypeFor } from "@/lib/mime";
import { serializeAdminTool } from "@/lib/serialize";
import {
  PathError,
  deleteStoredFile,
  resolveWithinRoot,
  statFile,
  toRelative,
} from "@/lib/storage";
import { countCategories, toolListWhere, toolOrderBy } from "@/lib/tools";
import { slugify } from "@/lib/validation";
import type {
  FileSource,
  ToolCreateInput,
  ToolReplaceInput,
  ToolUpdateInput,
  ToolsQuery,
} from "@/lib/validation";
import type { SerializedAdminTool } from "@/types";

/*
 * The write path (PRD §9.2, issue 22).
 *
 * Reads live in `lib/tools.ts`; this is its counterpart, and it exists for the
 * same reason: the route handlers stay thin, and the rules that must not vary —
 * re-resolving every client-supplied path, snapshotting size from a real `stat`,
 * writing exactly one audit row per mutation — live in one place where they can
 * be read together.
 *
 * Nothing here calls `fs`. Every filesystem touch goes through `lib/storage.ts`
 * (CONTEXT §2 item 2), including the deletion.
 */

export interface AdminToolListResult {
  tools: SerializedAdminTool[];
  total: number;
  categories: { name: string; count: number }[];
}

/** Like the public list, but unscoped: drafts, internal tools, and missing files all appear. */
export async function listAdminTools(query: ToolsQuery): Promise<AdminToolListResult> {
  const where = toolListWhere(query, true);

  const [tools, total, categories] = await Promise.all([
    prisma.tool.findMany({
      where,
      orderBy: toolOrderBy(query.sort),
      skip: (query.page - 1) * query.limit,
      take: query.limit,
    }),
    prisma.tool.count({ where }),
    countCategories(true),
  ]);

  return { tools: await Promise.all(tools.map(toAdminShape)), total, categories };
}

/** `Tool` → wire shape, with the path relativised (CONTEXT §2 item 5). */
export async function toAdminShape(tool: Tool): Promise<SerializedAdminTool> {
  return serializeAdminTool(tool, await toRelative(tool.filePath));
}

// --- file sources ------------------------------------------------------------

export interface ResolvedSource {
  /** Absolute — this is what `Tool.filePath` stores, and it never leaves the server. */
  absolutePath: string;
  relativePath: string;
  fileName: string;
  fileSize: bigint;
  mimeType: string;
}

/**
 * Turn a client-supplied file source into verified facts about a real file.
 *
 * The path is re-resolved through `lib/storage.ts` even when it came from this
 * app's own file browser (PRD §8.3: "revalidated server-side on submit"). The
 * browser modal is a convenience for the human, not a source of trust — the
 * field is a plain text input the admin can paste into, and even if it were not,
 * the request does not have to come from the page.
 *
 * `fileSize` is snapshotted from the `stat`, never taken from the request. It is
 * a display value (ADR-0002 keeps `Content-Length` on the live `stat`), but a
 * client-supplied size would be wrong in the catalogue for no reason.
 */
export async function resolveFileSource(file: FileSource): Promise<ResolvedSource> {
  const relative = file.source === "serverPath" ? file.relativePath : await uploadPath(file.uploadId);

  const absolutePath = await resolveWithinRoot(relative);
  // `statFile` rejects a directory and anything that is not a regular file.
  const stat = await statFile(relative);

  return {
    absolutePath,
    relativePath: stat.path,
    fileName: stat.name,
    fileSize: stat.size,
    mimeType: mimeTypeFor(stat.name),
  };
}

/**
 * Where a completed upload's bytes ended up.
 *
 * Derived from the convention issue 30 states — `<UPLOAD_SUBDIR>/<fileName>` —
 * rather than read from the row, because `Upload` has no column for the final
 * path. That is a real seam: issue 30 also allows an optional `targetSubdir`,
 * and this derivation cannot see one, so such an upload resolves to nothing and
 * 404s with a path the admin can recognise. **Issue 30 should persist the final
 * relative path on the `Upload` row and this function should read it** — noted
 * on that ticket rather than guessed at here.
 */
async function uploadPath(uploadId: string): Promise<string> {
  const upload = await prisma.upload.findUnique({ where: { id: uploadId } });

  if (upload === null) {
    throw new PathError("NOT_FOUND", "That upload does not exist");
  }
  if (upload.status !== "completed") {
    throw new PathError("NOT_FOUND", "That upload has not finished");
  }

  return `${getEnv().UPLOAD_SUBDIR}/${upload.fileName}`;
}

// --- slugs -------------------------------------------------------------------

export class SlugTakenError extends Error {
  constructor(readonly slug: string) {
    super(`The slug "${slug}" is already in use`);
    this.name = "SlugTakenError";
  }
}

/**
 * Resolve the slug for a write.
 *
 * The two cases are deliberately different. A slug the admin **typed** is a
 * decision, so a collision is an error they have to resolve — silently saving
 * them under `ubuntu-server-2` would be a surprise they discover later in a URL
 * they already shared. A slug **derived** from the name is a convenience, so a
 * collision just takes the next free suffix.
 */
export async function resolveSlug(
  requested: string | undefined,
  name: string,
  excludeId?: string,
): Promise<string> {
  if (requested !== undefined) {
    if (await slugTaken(requested, excludeId)) throw new SlugTakenError(requested);
    return requested;
  }

  const base = slugify(name) || "tool";
  if (!(await slugTaken(base, excludeId))) return base;

  // Bounded: a name colliding 200 times is a script, not a catalogue.
  for (let suffix = 2; suffix < 200; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await slugTaken(candidate, excludeId))) return candidate;
  }

  throw new SlugTakenError(base);
}

async function slugTaken(slug: string, excludeId?: string): Promise<boolean> {
  const existing = await prisma.tool.findUnique({ where: { slug }, select: { id: true } });
  return existing !== null && existing.id !== excludeId;
}

// --- mutations ---------------------------------------------------------------

export async function createTool(input: ToolCreateInput, actorIp: string): Promise<Tool> {
  const source = await resolveFileSource(input.file);
  const slug = await resolveSlug(input.slug, input.name);

  const tool = await prisma.tool.create({
    data: {
      slug,
      name: input.name,
      description: input.description,
      category: input.category,
      version: input.version,
      filePath: source.absolutePath,
      fileName: source.fileName,
      fileSize: source.fileSize,
      mimeType: source.mimeType,
      iconUrl: input.iconUrl ?? null,
      notes: input.notes ?? null,
      published: input.published ?? true,
      visibility: input.visibility ?? "public",
      featured: input.featured ?? false,
    },
  });

  await recordAudit("tool.create", {
    targetId: tool.id,
    actorIp,
    detail: { slug: tool.slug, name: tool.name, path: source.relativePath },
  });

  return tool;
}

/**
 * `PUT` and `PATCH` share this. The difference between them is what the schema
 * demands of the body, not what happens here — a partial update and a full
 * replacement both come down to "write the fields that arrived".
 */
export async function updateTool(
  existing: Tool,
  input: ToolReplaceInput | ToolUpdateInput,
  actorIp: string,
): Promise<Tool> {
  const data: Prisma.ToolUpdateInput = {};
  const changed: string[] = [];

  for (const field of ["name", "description", "category", "version", "iconUrl", "notes", "published", "visibility", "featured"] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value === existing[field]) continue;
    Object.assign(data, { [field]: value });
    changed.push(field);
  }

  if (input.slug !== undefined && input.slug !== existing.slug) {
    data.slug = await resolveSlug(input.slug, existing.name, existing.id);
    changed.push("slug");
  }

  /*
   * Re-`stat` whenever a source arrives, even when the path is unchanged. The
   * file on disk may have been replaced by an `rsync` since registration, and
   * carrying the old size forward would leave the catalogue quietly lying about
   * a number the admin can see. Doing so also clears `fileMissing`: the sweep
   * (issue 33) set it, and a successful stat is the proof that it is stale.
   */
  if (input.file !== undefined) {
    const source = await resolveFileSource(input.file);
    data.filePath = source.absolutePath;
    data.fileName = source.fileName;
    data.fileSize = source.fileSize;
    data.mimeType = source.mimeType;
    data.fileMissing = false;
    changed.push("file");
  }

  const tool = await prisma.tool.update({ where: { id: existing.id }, data });

  await recordAudit("tool.update", {
    targetId: tool.id,
    actorIp,
    detail: { slug: tool.slug, changed },
  });

  return tool;
}

export interface DeleteOutcome {
  fileDeleted: boolean;
}

/**
 * Remove a tool, and only on an explicit request its bytes (PRD §8.2, §16 D4).
 *
 * Order matters and is the opposite of the obvious one: the file goes first,
 * then the row. If the unlink is refused — a symlink, a shared path, gone
 * permissions — nothing has happened yet and the admin gets a real error to act
 * on. Deleting the row first would leave them with a vanished catalogue entry
 * and a failure message about a file that is still there, and no obvious way to
 * retry.
 */
export async function deleteTool(
  tool: Tool,
  deleteFile: boolean,
  actorIp: string,
): Promise<DeleteOutcome> {
  let fileDeleted = false;

  if (deleteFile) {
    /*
     * The third refusal from PRD §8.2, and the one `lib/storage.ts` cannot make
     * because it does not consult the database: two catalogue entries may point
     * at the same artifact — a duplicate created with the Copy action, or the
     * same ISO registered under two names — and deleting one of them must not
     * quietly break the other.
     */
    const alsoReferenced = await prisma.tool.count({
      where: { filePath: tool.filePath, id: { not: tool.id } },
    });
    if (alsoReferenced > 0) {
      throw new SharedFileError(alsoReferenced);
    }

    await deleteStoredFile(tool.filePath);
    fileDeleted = true;
  }

  await prisma.tool.delete({ where: { id: tool.id } });

  await recordAudit("tool.delete", {
    targetId: tool.id,
    actorIp,
    detail: {
      slug: tool.slug,
      name: tool.name,
      path: await toRelative(tool.filePath),
      fileDeleted,
    },
  });

  return { fileDeleted };
}

export class SharedFileError extends Error {
  constructor(readonly others: number) {
    super(
      `That file is also registered by ${others} other tool${others === 1 ? "" : "s"}. ` +
        "Remove this entry from the catalogue only, or delete the others first.",
    );
    this.name = "SharedFileError";
  }
}
