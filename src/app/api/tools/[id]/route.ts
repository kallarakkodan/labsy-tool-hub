import { apiFailure, notFound } from "@/lib/api";
import { isAdmin } from "@/lib/auth";
import { serializeTool } from "@/lib/serialize";
import { findTool } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/tools/[id] (PRD §9.1) — by id or slug.
 *
 * Out of scope is **404, never 403**. A 403 would confirm to an anonymous
 * visitor that an internal tool by that name exists, which is exactly what
 * `visibility: "admin"` is meant to prevent (PRD §16 D3).
 */
export async function GET(_request: Request, context: RouteContext<"/api/tools/[id]">) {
  // Next 16: params is a Promise.
  const { id } = await context.params;

  try {
    const tool = await findTool(id, await isAdmin());
    if (tool === null) return notFound("No such tool.");

    return Response.json(serializeTool(tool));
  } catch (error) {
    return apiFailure(error, "GET /api/tools/[id]");
  }
}
