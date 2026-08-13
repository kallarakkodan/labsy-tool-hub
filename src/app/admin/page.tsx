import { AdminHeader } from "@/components/admin/AdminHeader";
import { Dashboard } from "@/components/admin/Dashboard";
import { listAdminTools } from "@/lib/admin-tools";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Tools — Internal Tool Hub",
};

/**
 * `/admin` (PRD §8.2).
 *
 * A Server Component running the same query the admin API does, for the same
 * reason the public page does: fetching `/api/admin/tools` from here would be an
 * HTTP round trip to ourselves and a second place for the scoping to drift.
 *
 * No session check. `src/proxy.ts` redirects an unauthenticated visitor to
 * `/admin/login?next=/admin` before this renders (issue 21).
 *
 * There is deliberately no `admin/layout.tsx`. A layout would also wrap
 * `/admin/login`, and admin chrome around a sign-in form — nav links a
 * signed-out visitor cannot use — is a worse surface than repeating a header.
 * `AdminHeader` is that repeated header: rendered directly here, not in a
 * layout, so `/admin/login` never sees it.
 */
export default async function AdminPage() {
  const { tools, categories } = await listAdminTools({
    q: undefined,
    category: undefined,
    sort: "newest",
    page: 1,
    limit: 500,
  });

  /*
   * One clock read per request, handed to the client so "3 days ago" is computed
   * from the same instant on both sides of hydration (see `TableMeta.nowMs`).
   *
   * `react-hooks/purity` is right in general and wrong here: it guards against a
   * component that re-renders producing different output from the same props.
   * This is a Server Component on `force-dynamic` — it renders exactly once per
   * request, and reading the clock is the whole point. Doing it in the client
   * instead is what caused the hydration mismatch this replaced.
   */
  // eslint-disable-next-line react-hooks/purity
  const nowMs = Date.now();

  return (
    <main className="mx-auto max-w-[1400px] px-4 py-8 sm:px-6">
      <AdminHeader />
      <Dashboard tools={tools} categories={categories} nowMs={nowMs} />
    </main>
  );
}
