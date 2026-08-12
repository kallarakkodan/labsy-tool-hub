import { AppWindow, Disc3, FileArchive, FileDown, Package, Terminal } from "lucide-react";
import { fileIconKind } from "@/lib/icons";

/**
 * Renders the glyph for an artifact (PRD §7.3).
 *
 * A static switch rather than `const Icon = lookup(name)` followed by `<Icon/>`:
 * choosing a component identity during render is what
 * `react-hooks/static-components` warns about, and it would remount the icon
 * whenever the chosen component changed.
 */
export function FileIcon({ fileName, className }: { fileName: string; className?: string }) {
  switch (fileIconKind(fileName)) {
    case "disc":
      return <Disc3 className={className} aria-hidden="true" />;
    case "app":
      return <AppWindow className={className} aria-hidden="true" />;
    case "archive":
      return <FileArchive className={className} aria-hidden="true" />;
    case "package":
      return <Package className={className} aria-hidden="true" />;
    case "script":
      return <Terminal className={className} aria-hidden="true" />;
    default:
      return <FileDown className={className} aria-hidden="true" />;
  }
}
