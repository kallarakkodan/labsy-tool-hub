import { prisma } from "@/lib/db";
import { hashFile } from "@/lib/storage";

/*
 * Background SHA-256 hashing for server-path registrations (PRD §11.3, §13
 * row 3, issue 32). Uploads already hash for free during concatenation
 * (issue 30, `concatenateUpload`) and, when the resulting `Upload` row still
 * has it, `resolveFileSource` carries that value straight onto the `Tool`
 * without going anywhere near this queue — this module only exists for the
 * "registered by path" case, where nothing has read the bytes yet.
 *
 * A FIFO queue, not a semaphore per request: hashing an 8 GB file competes
 * with concurrent downloads for disk I/O (PRD §12.8), and the bound is
 * "at most one hash running at a time, process-wide" — not "at most one hash
 * per tool" or any other narrower scope that would still let two large files
 * thrash the disk together.
 *
 * The queue lives in module state, not tied to any request's lifetime: a job
 * enqueued from inside a POST handler must keep running after that handler's
 * response has already gone out.
 */

interface QueueEntry {
  toolId: string;
  absolutePath: string;
}

const queue: QueueEntry[] = [];
let running = false;

/** Enqueue a hash job for `toolId`. Fire-and-forget — never awaited by a request. */
export function enqueueChecksum(toolId: string, absolutePath: string): void {
  queue.push({ toolId, absolutePath });
  void drain();
}

async function drain(): Promise<void> {
  if (running) return;
  running = true;

  try {
    let entry: QueueEntry | undefined;
    while ((entry = queue.shift()) !== undefined) {
      await hashOne(entry);
    }
  } finally {
    running = false;
  }
}

async function hashOne({ toolId, absolutePath }: QueueEntry): Promise<void> {
  try {
    const checksum = await hashFile(absolutePath);
    await prisma.tool.update({ where: { id: toolId }, data: { checksum, checksumAt: new Date() } });
  } catch (error) {
    // The tool may have been deleted, or its file gone, while this sat in the
    // queue behind a large sibling. Either way the queue must keep moving —
    // one bad entry must not wedge every hash job behind it.
    console.error(`[checksum] failed to hash tool ${toolId}`, error);
  }
}
