import { apiError, apiFailure, notFound, validationFailed } from "@/lib/api";
import {
  SharedFileError,
  SlugTakenError,
  deleteTool,
  findToolByIdOrSlug,
  toAdminShape,
  updateTool,
} from "@/lib/admin-tools";
import { clientIp } from "@/lib/request";
import { toolDeleteQuerySchema, toolReplaceSchema, toolUpdateSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * /api/admin/tools/[id] (PRD §9.2)
 *
 * `PUT` replaces, `PATCH` merges, `DELETE` removes — and, only when explicitly
 * asked, the bytes too. Guarded by `src/proxy.ts`, not here (issue 21).
 */

/** Full replacement from the slide-over. Every core field is required. */
export async function PUT(request: Request, context: RouteContext<"/api/admin/tools/[id]">) {
  return write(request, context, toolReplaceSchema, "PUT");
}

/** Partial — what the Published switch sends. */
export async function PATCH(request: Request, context: RouteContext<"/api/admin/tools/[id]">) {
  return write(request, context, toolUpdateSchema, "PATCH");
}

export async function DELETE(request: Request, context: RouteContext<"/api/admin/tools/[id]">) {
  const query = toolDeleteQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!query.success) return validationFailed(query.error.issues);

  try {
    const existing = await findToolByIdOrSlug((await context.params).id);
    if (existing === null) return notFound("No tool with that id or slug.");

    const outcome = await deleteTool(existing, query.data.deleteFile, clientIp(request));
    return Response.json({ deleted: true, ...outcome });
  } catch (error) {
    if (error instanceof SharedFileError) {
      // 409, not 403: nothing about the request is forbidden, the catalogue is
      // simply in a state where this deletion would break another entry.
      return apiError("CONFLICT", error.message, 409);
    }
    return apiFailure(error, "DELETE /api/admin/tools/[id]");
  }
}

async function write(
  request: Request,
  context: RouteContext<"/api/admin/tools/[id]">,
  schema: typeof toolReplaceSchema | typeof toolUpdateSchema,
  method: string,
) {
  const parsed = schema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    const existing = await findToolByIdOrSlug((await context.params).id);
    if (existing === null) return notFound("No tool with that id or slug.");

    const tool = await updateTool(existing, parsed.data, clientIp(request));
    return Response.json(await toAdminShape(tool));
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return apiError("SLUG_TAKEN", error.message, 409);
    }
    return apiFailure(error, `${method} /api/admin/tools/[id]`);
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
