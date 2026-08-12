import { apiFailure } from "@/lib/api";
import { destroySession } from "@/lib/auth";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/auth/logout (PRD §9.2)
 *
 * Clearing the cookie is the whole of it. There is no session store to
 * invalidate (ADR-0001), so a token already copied out of the browser stays
 * valid until it expires — rotating `AUTH_SECRET` is the break-glass that kills
 * every session at once.
 *
 * POST, not GET, so a stray `<img src="/api/auth/logout">` on some other page
 * cannot sign an admin out.
 */
export async function POST() {
  try {
    await destroySession();
    return Response.json({ ok: true });
  } catch (error) {
    return apiFailure(error, "POST /api/auth/logout");
  }
}
