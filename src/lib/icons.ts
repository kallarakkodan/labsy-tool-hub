/**
 * Extension → icon kind (PRD §7.3). A custom `iconUrl` wins over all of this.
 *
 * This returns a plain string rather than a Lucide component so that nothing
 * picks a component identity at render time — see `components/public/FileIcon`.
 * It also makes the mapping testable without reaching into Lucide internals.
 *
 * Compound extensions are checked first so `.tar.gz` lands on the archive kind
 * rather than falling through a naive `lastIndexOf(".")` to `.gz`.
 */
export type IconKind = "disc" | "app" | "archive" | "package" | "script" | "file";

const COMPOUND: [suffix: string, kind: IconKind][] = [
  [".tar.gz", "archive"],
  [".tar.xz", "archive"],
  [".tar.bz2", "archive"],
];

const BY_EXTENSION: Record<string, IconKind> = {
  ".iso": "disc",
  ".img": "disc",
  ".exe": "app",
  ".msi": "app",
  ".zip": "archive",
  ".7z": "archive",
  ".gz": "archive",
  ".deb": "package",
  ".rpm": "package",
  ".pkg": "package",
  ".sh": "script",
  ".ps1": "script",
};

export function fileIconKind(fileName: string): IconKind {
  const lower = fileName.toLowerCase();

  for (const [suffix, kind] of COMPOUND) {
    if (lower.endsWith(suffix)) return kind;
  }

  const dot = lower.lastIndexOf(".");
  if (dot === -1) return "file";

  return BY_EXTENSION[lower.slice(dot)] ?? "file";
}
