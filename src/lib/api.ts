import { PathError } from "@/lib/storage";
import type { ApiErrorBody } from "@/types";

/*
 * The error envelope every failing handler returns (PRD §9):
 *
 *     { "error": { "code": "PATH_OUTSIDE_ROOT", "message": "…" } }
 *
 * Codes are SCREAMING_SNAKE and stable — the client switches on them, so
 * renaming one is a breaking change. Messages are for humans and may change.
 */

export const API_ERROR_CODES = [
  "VALIDATION_FAILED",
  "UNAUTHORIZED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "SLUG_TAKEN",
  "RATE_LIMITED",
  "INVALID_PATH",
  "PATH_OUTSIDE_ROOT",
  "NOT_A_DIRECTORY",
  "EACCES",
  "FILE_MISSING",
  "SIZE_MISMATCH",
  "INSUFFICIENT_STORAGE",
  "INTERNAL",
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];

export function apiError(
  code: ApiErrorCode,
  message: string,
  status: number,
  headers?: HeadersInit,
): Response {
  const body: ApiErrorBody = { error: { code, message } };
  return Response.json(body, { status, headers });
}

/** PRD §9.3's status mapping, in one place so browse and download cannot drift. */
const PATH_ERROR_STATUS: Record<PathError["code"], number> = {
  INVALID_PATH: 400,
  PATH_OUTSIDE_ROOT: 403,
  NOT_FOUND: 404,
  NOT_A_DIRECTORY: 400,
  EACCES: 403,
};

/**
 * Turn any thrown value into a response without leaking what threw.
 *
 * A `PathError` is safe to surface: its message is written by `lib/storage.ts`
 * and only ever names the relative path the caller already sent. Anything else
 * is logged server-side and becomes a flat 500 — an `fs` or Prisma error message
 * contains absolute host paths and sometimes query fragments (CONTEXT §6,
 * PRD §11.2).
 *
 * Note this never returns 403 for a *missing tool*. Tool scoping is decided by
 * `toolVisibilityWhere` and always answers 404, because a 403 confirms that an
 * internal tool by that name exists.
 */
export function apiFailure(error: unknown, context: string): Response {
  if (error instanceof PathError) {
    return apiError(error.code, error.message, PATH_ERROR_STATUS[error.code]);
  }

  console.error(`[${context}]`, error);
  return apiError("INTERNAL", "Something failed on the server. Check the service logs.", 500);
}

/** Zod's issue list, flattened into one human sentence, as a 400. */
export function validationFailed(issues: { path: PropertyKey[]; message: string }[]): Response {
  const detail = issues
    .map((issue) => `${issue.path.join(".") || "body"}: ${issue.message}`)
    .join("; ");

  return apiError("VALIDATION_FAILED", detail || "Request was not valid.", 400);
}

/** `401` for the guarded API groups (PRD §8.1) — JSON, never an HTML redirect. */
export function unauthorized(): Response {
  return apiError("UNAUTHORIZED", "Sign in to the admin panel to do that.", 401);
}

/**
 * `429` with `Retry-After` (PRD §11.2), from a `lib/rate-limit.ts` result.
 *
 * The header is the contract — the login page counts down against it — so it is
 * set here rather than left to each caller to remember.
 */
export function rateLimited(retryAfter: number, message = "Too many requests. Try again shortly."): Response {
  return apiError("RATE_LIMITED", message, 429, { "Retry-After": String(retryAfter) });
}

/** `404` for anything out of scope, including tools hidden by visibility. */
export function notFound(what = "Not found."): Response {
  return apiError("NOT_FOUND", what, 404);
}
