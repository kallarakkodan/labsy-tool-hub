import { apiFailure, rateLimited, validationFailed } from "@/lib/api";
import { consumeRateLimit } from "@/lib/rate-limit";
import { sessionKey } from "@/lib/request";
import { listDirectory } from "@/lib/storage";
import { browseQuerySchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * GET /api/browse (PRD §9.3, issue 26)
 *
 * Every filesystem rule this endpoint enforces lives in `lib/storage.ts`'s
 * `listDirectory` — this handler parses the query, rate limits, and translates
 * whatever comes back. No `fs` call belongs here (CONTEXT §2 item 2): a second
 * path-resolution site is a second place to get containment wrong.
 *
 * The session guard is `src/proxy.ts`'s job (issue 21) — by the time this runs,
 * the caller is already known to be signed in, which is what makes `sessionKey`
 * a safe rate-limit key rather than something an anonymous caller could churn.
 */
export async function GET(request: Request) {
  const gate = consumeRateLimit("browse", sessionKey(request));
  if (!gate.allowed) return rateLimited(gate.retryAfter);

  const parsed = browseQuerySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    const listing = await listDirectory(parsed.data.path, { showHidden: parsed.data.showHidden });
    return Response.json(listing);
  } catch (error) {
    return apiFailure(error, "GET /api/browse");
  }
}
