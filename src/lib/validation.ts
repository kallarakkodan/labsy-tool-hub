import { z } from "zod";

/*
 * Zod schemas shared by the forms and the handlers (CONTEXT §6).
 *
 * The form uses these through `zodResolver`; the handler re-parses the same
 * schema on arrival. Client validation is UX, server validation is truth — and
 * because both sides run the *same* transforms, a category typed as
 * "  os images  " normalises identically in the browser and on the server. Two
 * separate normalisations is how you get duplicate categories that look equal.
 *
 * Field constraints are PRD §8.3's table.
 */

/** Strips path separators, control characters, and leading dots (PRD §9.5). */
export function sanitizeFileName(input: string): string {
  const basename = input.split(/[/\\]/).pop() ?? "";
  return (
    basename
      // Control characters, including NUL. Written as escapes so an editor cannot eat them.
      .replace(/[\u0000-\u001f\u007f]/g, "")
      .replace(/^\.+/, "")
      .trim()
  );
}

/** "  os   images " -> "Os Images". Applied on both sides so they cannot disagree. */
export function normalizeCategory(input: string): string {
  return input
    .trim()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((word) => (word.length === 0 ? word : word[0]!.toUpperCase() + word.slice(1).toLowerCase()))
    .join(" ");
}

/** URL-safe, stable, derived from the name but independently editable (PRD §8.3). */
export function slugify(input: string): string {
  return input
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
}

const slug = z
  .string()
  .min(1, "required")
  .max(80)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase letters, digits, and single hyphens only");

const iconUrl = z
  .string()
  .max(2048)
  .refine(
    (value) => value === "" || /^https?:\/\//.test(value) || value.startsWith("/"),
    "must be an http(s) URL or a path starting with /",
  )
  .transform((value) => (value === "" ? null : value))
  .nullable()
  .optional();

/** The shared field set. Create requires a source; update does not re-send one. */
const toolFields = {
  name: z.string().trim().min(2, "at least 2 characters").max(80),
  description: z.string().trim().min(1, "required").max(280, "at most 280 characters"),
  category: z.string().trim().min(1, "required").max(40).transform(normalizeCategory),
  version: z.string().trim().min(1, "required").max(40),
  iconUrl,
  notes: z.string().max(2000).nullable().optional(),
  published: z.boolean().optional(),
  /** The switch is "Internal only"; the column is an enum (PRD §16 D3). */
  visibility: z.enum(["public", "admin"]).optional(),
  featured: z.boolean().optional(),
};

/**
 * Where the bytes come from. Exactly one, and the server re-resolves whichever
 * arrives — a client-supplied path is never trusted, even from the file browser
 * (PRD §8.3, "revalidated server-side on submit").
 */
export const fileSourceSchema = z.discriminatedUnion("source", [
  z.object({
    source: z.literal("serverPath"),
    /** Relative to STORAGE_ROOT. The client never sees or sends an absolute path. */
    relativePath: z.string().min(1, "select a file").max(4096),
  }),
  z.object({
    source: z.literal("upload"),
    uploadId: z.string().min(1),
  }),
]);

export const toolCreateSchema = z.object({
  ...toolFields,
  slug: slug.optional(),
  file: fileSourceSchema,
});

/**
 * `PUT` — a full replacement from the slide-over, which always sends every core
 * field. `file` stays optional because editing a tool's name must not require
 * re-selecting its bytes; omitting it keeps the current path, size, and type.
 */
export const toolReplaceSchema = z.object({
  ...toolFields,
  slug: slug.optional(),
  file: fileSourceSchema.optional(),
});

/** Every field optional — `PATCH`, and what the Published switch sends. */
export const toolUpdateSchema = z.object({
  name: toolFields.name.optional(),
  description: toolFields.description.optional(),
  category: toolFields.category.optional(),
  version: toolFields.version.optional(),
  iconUrl,
  notes: toolFields.notes,
  published: toolFields.published,
  visibility: toolFields.visibility,
  featured: toolFields.featured,
  slug: slug.optional(),
  file: fileSourceSchema.optional(),
});

export const toolsQuerySchema = z.object({
  q: z.string().trim().max(200).optional(),
  category: z.string().trim().max(40).optional(),
  sort: z.enum(["newest", "name", "size"]).optional().transform((v) => v ?? "newest"),
  page: z.coerce.number().int().min(1).optional().transform((v) => v ?? 1),
  limit: z.coerce.number().int().min(1).max(500).optional().transform((v) => v ?? 100),
});

export const browseQuerySchema = z.object({
  /** Defaults to the root. Validated properly by `resolveWithinRoot`, not here. */
  path: z.string().max(4096).optional().transform((v) => v ?? ""),
  showHidden: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
});

export const uploadInitSchema = z.object({
  fileName: z
    .string()
    .min(1, "required")
    .max(255)
    .transform(sanitizeFileName)
    .refine((name) => name.length > 0, "filename is empty after sanitisation"),
  /**
   * A string, not a number: an 8 GB upload is fine in a double, but sizes are
   * BigInt everywhere else in this codebase and accepting a number here would
   * be the one place the boundary leaks back in.
   */
  totalSize: z
    .string()
    .regex(/^\d+$/, "must be a decimal byte count")
    .transform((value) => BigInt(value))
    .refine((value) => value > 0n, "must be greater than zero"),
  mimeType: z.string().max(255).optional(),
});

/**
 * `POST /api/uploads/[id]/complete` (PRD §9.5, issue 30). `targetSubdir` is
 * only shape-validated here — a string, not too long. The safety check
 * (neutralising `..`, containment) is `lib/storage.ts`'s `resolveUploadDestination`,
 * the same division of labour as every other path in this codebase: Zod
 * validates shape, `lib/storage.ts` validates safety.
 */
export const uploadCompleteSchema = z.object({
  targetSubdir: z.string().max(500).optional(),
  overwrite: z.boolean().optional(),
});

export type UploadCompleteInput = z.infer<typeof uploadCompleteSchema>;

/**
 * The login body (PRD §8.1). No username — there is one shared password.
 *
 * The maximum is not a policy about password strength; it is a cap on how much
 * work an unauthenticated caller can ask for. scrypt is deliberately expensive,
 * and hashing a megabyte of submitted "password" once per request is a free CPU
 * denial of service.
 */
export const loginSchema = z.object({
  password: z.string().min(1, "required").max(1024, "too long"),
});

export type LoginInput = z.infer<typeof loginSchema>;

/** `?deleteFile=true` on `DELETE /api/admin/tools/[id]` (PRD §8.2). */
export const toolDeleteQuerySchema = z.object({
  // Only the exact string "true" removes bytes. Anything else — absent, "1",
  // "yes", a typo — falls back to the safe catalogue-only removal.
  deleteFile: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

export type FileSource = z.infer<typeof fileSourceSchema>;
export type ToolCreateInput = z.infer<typeof toolCreateSchema>;
export type ToolReplaceInput = z.infer<typeof toolReplaceSchema>;
export type ToolUpdateInput = z.infer<typeof toolUpdateSchema>;
export type ToolsQuery = z.infer<typeof toolsQuerySchema>;
export type BrowseQuery = z.infer<typeof browseQuerySchema>;
export type UploadInitInput = z.infer<typeof uploadInitSchema>;
