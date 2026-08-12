import path from "node:path";

/*
 * Extension → MIME type, snapshotted onto `Tool.mimeType` at registration.
 *
 * Deliberately a small table rather than a dependency. Everything this hub
 * serves is an opaque binary that downloads rather than renders, so the value is
 * advisory: `application/octet-stream` is a correct answer for every row here,
 * and the specific types exist only so a browser's "what is this" affordances
 * (and `curl -I`) say something more useful than "bytes".
 *
 * It is never used to decide whether something is safe to render. Downloads
 * always carry `Content-Disposition: attachment` (PRD §11.2), which is what
 * stops a stored HTML or SVG file from executing in this origin — sniffing the
 * type here and trusting it would undo that.
 */

const COMPOUND: [suffix: string, type: string][] = [
  [".tar.gz", "application/gzip"],
  [".tar.xz", "application/x-xz"],
  [".tar.bz2", "application/x-bzip2"],
];

const BY_EXTENSION: Record<string, string> = {
  ".iso": "application/x-iso9660-image",
  ".img": "application/octet-stream",
  ".exe": "application/vnd.microsoft.portable-executable",
  ".msi": "application/x-msi",
  ".dmg": "application/x-apple-diskimage",
  ".pkg": "application/vnd.apple.installer+xml",
  ".appimage": "application/x-executable",
  ".deb": "application/vnd.debian.binary-package",
  ".rpm": "application/x-rpm",
  ".zip": "application/zip",
  ".7z": "application/x-7z-compressed",
  ".gz": "application/gzip",
  ".tar": "application/x-tar",
  ".sh": "application/x-shellscript",
  ".ps1": "application/x-powershell",
  ".txt": "text/plain",
  ".json": "application/json",
  ".pdf": "application/pdf",
};

export const DEFAULT_MIME_TYPE = "application/octet-stream";

export function mimeTypeFor(fileName: string): string {
  const lower = fileName.toLowerCase();

  // Compound suffixes first, so `.tar.gz` does not fall through to `.gz`.
  for (const [suffix, type] of COMPOUND) {
    if (lower.endsWith(suffix)) return type;
  }

  return BY_EXTENSION[path.extname(lower)] ?? DEFAULT_MIME_TYPE;
}
