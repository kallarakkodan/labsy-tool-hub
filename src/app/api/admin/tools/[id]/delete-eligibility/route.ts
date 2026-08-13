import { apiFailure, notFound } from "@/lib/api";
import { checkFileDeleteEligibility, findToolByIdOrSlug } from "@/lib/admin-tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/admin/tools/[id]/delete-eligibility (PRD §8.2, issue 25)
 *
 * A preview of the refusals `DELETE .../[id]?deleteFile=true` enforces, so the
 * delete dialog can decide whether to offer the file-deletion radio *before*
 * the admin commits to anything. Read-only — it never unlinks — and it is not
 * a second implementation of the rule: `checkFileDeleteEligibility` shares its
 * checks with `deleteTool` (see that function's docs).
 */
export async function GET(
  _request: Request,
  context: RouteContext<"/api/admin/tools/[id]/delete-eligibility">,
) {
  try {
    const tool = await findToolByIdOrSlug((await context.params).id);
    if (tool === null) return notFound("No tool with that id or slug.");

    return Response.json(await checkFileDeleteEligibility(tool));
  } catch (error) {
    return apiFailure(error, "GET /api/admin/tools/[id]/delete-eligibility");
  }
}
