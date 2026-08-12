import { ToolGridSkeleton } from "@/components/public/ToolGridStates";

/**
 * Route-level loading state. A skeleton matching the final grid, never a centred
 * spinner (PRD §5.5). The toolbar is skipped deliberately: its pill labels are
 * not known until the data arrives, and inventing placeholder pills would make
 * the row jump when the real ones replace them.
 */
export default function Loading() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <ToolGridSkeleton />
    </main>
  );
}
