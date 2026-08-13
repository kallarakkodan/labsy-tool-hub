import { prisma } from "@/lib/db";
import { removeUploadDir } from "@/lib/storage";

/*
 * The upload janitor (PRD §9.5, issue 28): reaps `Upload` rows past
 * `expiresAt` and their temp directories, on boot and hourly thereafter.
 *
 * The narrow, documented exception to "no scheduled job ever deletes from
 * STORAGE_ROOT" (PRD §14, §16 D4): this only ever removes a specific
 * `Upload.tempDir` it already has a row for, never anything discovered by
 * listing `.uploads` itself. A directory under `.uploads` with no matching row
 * — orphaned by a crash between `createUploadDir` and the row insert — is left
 * alone rather than guessed at; see `lib/storage.ts`'s `createUploadDir`.
 */

/** Delete every `Upload` whose `expiresAt` has passed, and its temp directory. Returns the count reaped. */
export async function reapExpiredUploads(now: Date = new Date()): Promise<number> {
  const expired = await prisma.upload.findMany({ where: { expiresAt: { lt: now } } });

  for (const upload of expired) {
    await removeUploadDir(upload.tempDir);
    // Deleted one at a time, after its directory is gone, rather than a single
    // `deleteMany`: if the process is killed mid-sweep, every row still in the
    // table still has bytes on disk to match it, so the next run's state is
    // consistent rather than a phantom "cleaned up" row with orphaned bytes.
    await prisma.upload.delete({ where: { id: upload.id } });
  }

  return expired.length;
}

let timer: NodeJS.Timeout | null = null;

/**
 * Run once immediately, then on `intervalMs` (default one hour). Idempotent —
 * a second call is a no-op — so `instrumentation.ts` can call this without a
 * module-level guard of its own.
 *
 * `unref()` so the interval never keeps the process alive by itself; the HTTP
 * server is what does that.
 */
export function startUploadJanitor(intervalMs: number = 60 * 60_000): void {
  if (timer !== null) return;

  void reapExpiredUploads().catch((error) => console.error("[upload-janitor]", error));

  timer = setInterval(() => {
    void reapExpiredUploads().catch((error) => console.error("[upload-janitor]", error));
  }, intervalMs);
  timer.unref();
}

/** Test seam: stop the interval and forget it started, so a re-run of `startUploadJanitor` is not a no-op. */
export function stopUploadJanitor(): void {
  if (timer !== null) clearInterval(timer);
  timer = null;
}
