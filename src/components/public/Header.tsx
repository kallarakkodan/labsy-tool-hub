import Link from "next/link";
import { Suspense } from "react";
import { HardDriveDownload } from "lucide-react";
import { HealthDot } from "./HealthDot";
import { SearchInput } from "./SearchInput";

/**
 * Sticky 64px header (PRD §7.1).
 *
 * A Server Component holding two client islands: the search input and the
 * health dot. Everything else here is static markup and does not need to ship.
 *
 * SearchInput reads `useSearchParams`, so it sits behind Suspense — Next
 * requires that for any client component reading search params, and the
 * fallback keeps the header from reflowing while it resolves.
 */
export function Header() {
  return (
    <header className="sticky top-0 z-40 h-16 border-b border-border bg-base/80 backdrop-blur-sm">
      <div className="mx-auto flex h-full max-w-[1280px] items-center gap-4 px-4 sm:px-6">
        <Link href="/" className="flex shrink-0 items-center gap-2 rounded-button focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35">
          <HardDriveDownload className="size-5 text-accent" aria-hidden="true" />
          <span className="text-[15px] font-semibold tracking-[-0.02em] text-fg">Internal Tool Hub</span>
        </Link>

        <div className="flex flex-1 justify-center">
          <Suspense fallback={<div className="h-9 w-full max-w-[480px] rounded-card border border-border bg-inset" />}>
            <SearchInput />
          </Suspense>
        </div>

        <div className="flex shrink-0 items-center">
          <HealthDot />
        </div>
      </div>
    </header>
  );
}
