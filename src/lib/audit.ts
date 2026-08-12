import { prisma } from "@/lib/db";

/*
 * The audit trail (PRD §6, §11.2).
 *
 * The table ships now and the reporting UI is P6, because backfilling an audit
 * trail after the fact is worse than an unused table.
 */

/**
 * The actions written today. A union rather than a free string so a typo becomes
 * a type error instead of a row nobody will ever query for.
 */
export type AuditAction =
  | "auth.login.fail"
  | "tool.create"
  | "tool.update"
  | "tool.delete"
  | "upload.complete";

export interface AuditEntry {
  targetId?: string | null;
  /** Anything JSON-serialisable. Keep paths **relative** — see below. */
  detail?: Record<string, unknown>;
  actorIp?: string | null;
}

/**
 * Write one audit row. **Never throws.**
 *
 * A failed audit insert must not fail the operation that triggered it: the
 * security control is the thing that just happened — the rate limiter, the
 * permission check — and this is the record of it, not the enforcement. A login
 * that 500s because SQLite was briefly locked would be a worse outcome than a
 * missing row, and the failure is logged either way.
 *
 * Paths in `detail` are relative to `STORAGE_ROOT`, never absolute. The P6
 * reporting UI will render these rows, and an absolute host path in a column
 * that eventually reaches a browser is the leak CONTEXT §2 item 5 describes —
 * easier to prevent at the write than to remember at the read.
 */
export async function recordAudit(action: AuditAction, entry: AuditEntry = {}): Promise<void> {
  try {
    await prisma.auditLog.create({
      data: {
        action,
        targetId: entry.targetId ?? null,
        detail: entry.detail === undefined ? null : JSON.stringify(entry.detail),
        actorIp: entry.actorIp ?? null,
      },
    });
  } catch (error) {
    console.error(`[audit] could not record ${action}`, error);
  }
}
