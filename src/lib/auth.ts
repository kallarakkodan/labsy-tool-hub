/*
 * Authentication (PRD §8.1, ADR-0001).
 *
 * TEMPORARY: only `isAdmin()` exists, and it always answers "no". Issue 18
 * replaces this body with a real `jose` JWE session read; `verifyPassword`,
 * `seal`, and `unseal` arrive with it.
 *
 * It is a whole module rather than an inline `false` at each call site on
 * purpose. Every read path already routes admin-ness through this one function,
 * so issue 18 is a change to one body — not a hunt for the places that guessed.
 */

/**
 * Whether the caller holds a valid admin session.
 *
 * Never derive this from a query parameter, a header, or anything else the
 * client controls (CONTEXT §7.4). It feeds `toolVisibilityWhere`, so a spoofable
 * source here exposes every draft and internal tool at once.
 */
export async function isAdmin(): Promise<boolean> {
  return Promise.resolve(false);
}
