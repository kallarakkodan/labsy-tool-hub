"use client";

import { useEffect } from "react";
import { CatalogueError } from "@/components/public/ToolGridStates";

/**
 * Error boundary for the catalogue. Realistically this fires when the database
 * is unreachable, which is why the copy points at `systemctl status` rather than
 * saying something failed and leaving the reader to guess (PRD §5.5).
 */
export default function Error({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => {
    console.error("[catalogue]", error);
  }, [error]);

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <CatalogueError />
    </main>
  );
}
