"use client";

import { useCallback, useMemo } from "react";
import { usePathname, useSearchParams } from "next/navigation";
import { filtersFromParams, paramsFromFilters, type Filters } from "@/lib/filters";

/**
 * Read and write the catalogue filter state in the URL.
 *
 * `window.history.replaceState` rather than `router.replace`: Next syncs the
 * native history methods into `useSearchParams`, so every subscriber re-renders
 * without a server round trip. `router.replace` would refetch the RSC payload on
 * every keystroke, which is exactly what CONTEXT §6 says not to do.
 *
 * `replaceState`, not `pushState`: typing eight characters should not put eight
 * entries in the back stack. Back should leave the catalogue, not undo a filter
 * one character at a time.
 */
export function useFilters() {
  const searchParams = useSearchParams();
  const pathname = usePathname();

  const filters = useMemo(() => filtersFromParams(searchParams), [searchParams]);

  const setFilters = useCallback(
    (next: Filters) => {
      window.history.replaceState(null, "", `${pathname}${paramsFromFilters(next)}`);
    },
    [pathname],
  );

  const patch = useCallback(
    (partial: Partial<Filters>) => {
      setFilters({ ...filters, ...partial });
    },
    [filters, setFilters],
  );

  return { filters, setFilters, patch };
}
