import { apiError, apiFailure, rateLimited, validationFailed } from "@/lib/api";
import { recordAudit } from "@/lib/audit";
import { createSession, verifyPassword } from "@/lib/auth";
import { checkRateLimit, clearRateLimit, recordAttempt } from "@/lib/rate-limit";
import { clientIp } from "@/lib/request";
import { loginSchema } from "@/lib/validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/*
 * POST /api/auth/login (PRD §8.1, §9.2)
 *
 * The one place a password is accepted. Both rejections say the same thing —
 * only the status code and the headers differ — because the message is what an
 * unauthenticated caller reads and it should carry no information. The login
 * page reads the headers instead, and shows the admin the real story.
 */
const REJECTED = "Sign-in failed. Check the password, and wait a while if you have tried several times.";

export async function POST(request: Request) {
  const ip = clientIp(request);

  /*
   * Checked before the body is even read, and *not* recorded here: PRD §8.1
   * counts failed passwords, so a check-then-record split is what keeps a
   * malformed body or a correct password from consuming someone's five.
   */
  const gate = checkRateLimit("login", ip);
  if (!gate.allowed) return rateLimited(gate.retryAfter, REJECTED);

  const parsed = loginSchema.safeParse(await readJson(request));
  if (!parsed.success) return validationFailed(parsed.error.issues);

  try {
    if (!(await verifyPassword(parsed.data.password))) {
      const after = recordAttempt("login", ip);
      /*
       * Only real password failures are written. A 429 is deliberately silent:
       * the flood that triggers it is exactly the traffic that would fill the
       * table, and the limiter already knows about it.
       */
      await recordAudit("auth.login.fail", { actorIp: ip });

      const headers: Record<string, string> = { "X-RateLimit-Remaining": String(after.remaining) };
      // The failure that used up the last attempt already knows how long the
      // lockout runs, so send it now rather than making the admin trigger a 429
      // to find out.
      if (!after.allowed) headers["Retry-After"] = String(after.retryAfter);

      return apiError("UNAUTHORIZED", REJECTED, 401, headers);
    }

    // Someone who knows the password was not the one attacking. Leaving four
    // earlier typos in the bucket would lock them out on the next genuine slip.
    clearRateLimit("login", ip);
    await createSession();

    return Response.json({ ok: true });
  } catch (error) {
    return apiFailure(error, "POST /api/auth/login");
  }
}

/** A body that is not JSON is a validation failure, not a 500. */
async function readJson(request: Request): Promise<unknown> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

