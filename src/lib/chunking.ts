/**
 * Pure chunk-size arithmetic for the upload protocol (PRD §9.5), shared by the
 * server's pre-flight check (`lib/storage.ts`'s `verifyUploadParts`) and the
 * upload client's resume byte-accounting (`UploadDropzone`) — one formula, so
 * the two cannot silently disagree about where the last, possibly-short chunk
 * boundary falls. `number`, not `bigint`: both callers already convert down to
 * this scale (realistic upload sizes sit nowhere near 2^53 bytes), and a plain
 * number is what a client-side `File.size` gives you regardless.
 */
export function expectedChunkSize(
  index: number,
  totalChunks: number,
  chunkSize: number,
  totalSize: number,
): number {
  return index === totalChunks - 1 ? totalSize - chunkSize * (totalChunks - 1) : chunkSize;
}
