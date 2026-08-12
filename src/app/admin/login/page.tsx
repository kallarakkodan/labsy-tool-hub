import { redirect } from "next/navigation";
import { LoginForm } from "@/components/admin/LoginForm";
import { isAdmin } from "@/lib/auth";
import { safeNextPath } from "@/lib/request";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Sign in — Internal Tool Hub",
};

/**
 * `/admin/login` (PRD §8.1). One password field, no username.
 *
 * `?next=` is validated here, on the server, before it ever reaches the client
 * component — so the value the form redirects to is known to be a relative
 * `/admin/**` path and cannot be an off-origin URL an attacker put in a link.
 */
export default async function LoginPage({ searchParams }: PageProps<"/admin/login">) {
  const next = safeNextPath((await searchParams).next as string | undefined);

  // Already signed in: the guard sent them here for nothing, so finish the trip.
  if (await isAdmin()) redirect(next);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-[400px] flex-col justify-center px-6 py-16">
      <div className="rounded-card border border-border bg-surface p-6">
        <h1 className="text-lg font-semibold text-fg">Admin sign-in</h1>
        <p className="mt-1 text-sm text-fg-muted">
          The shared admin password. Ask whoever provisioned the hub if you do not have it.
        </p>

        <LoginForm next={next} />
      </div>

      <p className="mt-4 px-1 text-xs text-fg-subtle">
        Sessions last 8 hours and are scoped to this browser.
      </p>
    </main>
  );
}
