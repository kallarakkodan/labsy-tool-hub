import { apiFailure, validationFailed } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { listTools } from "@/lib/tools";
import { toolsQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools (PRD §9.1)
 *
 * `?q=&category=&sort=newest|name|size&page=&limit=`
 *
 * Scoped by `toolVisibilityWhere`. An admin session additionally sees drafts and
 * internal tools, each flagged in the payload so the UI can badge them.
 */
export async function GET(request: Request) {
  const parsed = toolsQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    return Response.json(await listTools(parsed.data, await isAdmin()));
  } catch (error) {
    return apiFailure(error, "GET /api/tools");
  }
}
