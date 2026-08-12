import { apiFailure } from "@/lib/api";
import { countCategories } from "@/lib/tools";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/admin/categories (PRD §9.2)
 *
 * Feeds the slide-over's category combobox, which is why it is unscoped: an
 * admin typing a category should see the one an internal tool already uses,
 * rather than creating a near-duplicate that differs only in case. The public
 * pills use the same helper with `isAdmin: false`.
 */
export async function GET() {
  try {
    return Response.json({ categories: await countCategories(true) });
  } catch (error) {
    return apiFailure(error, "GET /api/admin/categories");
  }
}
