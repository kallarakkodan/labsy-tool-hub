import { Suspense } from "react";
import { isAdmin } from "@/lib/auth";
import { listTools } from "@/lib/tools";
import { Catalogue } from "@/components/public/Catalogue";

export const dynamic = "force-dynamic";

/**
 * The public catalogue (PRD §7).
 *
 * A Server Component: it runs the same scoped query the API does (via
 * `lib/tools.ts`) and hands the whole in-scope list to the client, which filters
 * it locally. Fetching `/api/tools` from here would be an HTTP round trip to
 * ourselves and a second place for the visibility scoping to drift.
 */
export default async function Home() {
  const { tools, total, categories } = await listTools(
    { q: undefined, category: undefined, sort: "newest", page: 1, limit: 500 },
    await isAdmin(),
  );

  return (
    <main className="mx-auto max-w-[1280px] px-4 py-8 sm:px-6">
      <Suspense fallback={null}>
        <Catalogue tools={tools} categories={categories} total={total} />
      </Suspense>
    </main>
  );
}
