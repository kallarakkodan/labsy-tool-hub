import { apiError, apiFailure, validationFailed } from "@/lib/api";
import { SlugTakenError, createTool, listAdminTools, toAdminShape } from "@/lib/admin-tools";
import { clientIp } from "@/lib/request";
import { toolCreateSchema, toolsQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * /api/admin/tools (PRD §9.2)
 *
 * The session is not checked here. `src/proxy.ts` guards every `/api/admin/**`
 * path with a real decrypt and 401s before a handler runs (issue 21), so a
 * second check in each file would be a second thing to forget rather than a
 * second layer.
 */

/** Everything, including drafts, internal tools, and rows whose file is missing. */
export async function GET(request: Request) {
  const parsed = toolsQuerySchema.safeParse(Object.fromEntries(new URL(request.url).searchParams));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    return Response.json(await listAdminTools(parsed.data));
  } catch (error) {
    return apiFailure(error, "GET /api/admin/tools");
  }
}

export async function POST(request: Request) {
  const parsed = toolCreateSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    const tool = await createTool(parsed.data, clientIp(request));
    return Response.json(await toAdminShape(tool), { status: 201 });
  } catch (error) {
    if (error instanceof SlugTakenError) {
      return apiError("SLUG_TAKEN", error.message, 409);
    }
    // A path outside the root, a directory, or a missing file all surface as the
    // PathError statuses from PRD §9.3 — `apiFailure` maps them.
    return apiFailure(error, "POST /api/admin/tools");
  }
}

async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}
