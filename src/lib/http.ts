/*
 * HTTP details the download route depends on, kept separate so they can be
 * tested without a filesystem or a database.
 */

export interface ParsedRange {
  start: number;
  end: number;
}

export type RangeResult =
  | { kind: "none" }
  | { kind: "satisfiable"; range: ParsedRange }
  | { kind: "unsatisfiable" };

/**
 * Parse a single-range `Range: bytes=…` header (PRD §9.4 step 6).
 *
 * Only one range is honoured. Multi-range responses require a
 * `multipart/byteranges` body, which no download manager needs for a single
 * artifact — a multi-range request is answered with the whole file instead,
 * which is always a valid response.
 *
 * `size` is a number rather than a BigInt: it comes from `stat`, and Node cannot
 * express a read stream offset beyond `Number.MAX_SAFE_INTEGER` anyway. Nine
 * petabytes is not the constraint here.
 */
export function parseRange(header: string | null, size: number): RangeResult {
  if (header === null) return { kind: "none" };

  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (match === null) return { kind: "none" }; // malformed: ignore and send the whole file

  const [, rawStart, rawEnd] = match;
  const hasStart = rawStart !== "";
  const hasEnd = rawEnd !== "";

  if (!hasStart && !hasEnd) return { kind: "none" };

  // An empty file cannot satisfy any range.
  if (size === 0) return { kind: "unsatisfiable" };

  let start: number;
  let end: number;

  if (!hasStart) {
    // `bytes=-512` — the *last* 512 bytes, not "from 0 to 512".
    const suffixLength = Number(rawEnd);
    if (suffixLength === 0) return { kind: "unsatisfiable" };
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = hasEnd ? Number(rawEnd) : size - 1;
    // A range that runs past the end is clamped, not rejected (RFC 9110).
    if (end > size - 1) end = size - 1;
  }

  if (start > end || start >= size) return { kind: "unsatisfiable" };

  return { kind: "satisfiable", range: { start, end } };
}

/**
 * `Content-Disposition: attachment` with both forms (PRD §9.4 step 5, RFC 5987).
 *
 * The ASCII fallback is for clients that ignore `filename*`; the encoded form
 * carries the real name. Artifact names contain spaces, parentheses, and
 * occasionally non-ASCII, and a bare `filename="…"` mangles all three.
 *
 * Quotes and backslashes are stripped from the fallback rather than escaped: a
 * filename containing a quote would otherwise let the value break out of its own
 * quoting and inject a header parameter.
 */
export function contentDisposition(fileName: string): string {
  const asciiFallback =
    // Anything outside printable ASCII becomes _; control characters must not reach a header.
    fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "") || "download";

  return `attachment; filename="${asciiFallback}"; filename*=UTF-8''${encodeRFC5987(fileName)}`;
}

function encodeRFC5987(value: string): string {
  return encodeURIComponent(value)
    .replace(/['()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase())
    .replace(/%(7C|60|5E)/g, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)));
}

/** `"<size>-<mtimeMs>"` — cheap, and changes whenever the bytes could have. */
export function etagFor(size: number | bigint, mtimeMs: number): string {
  return `"${size}-${Math.floor(mtimeMs)}"`;
}
