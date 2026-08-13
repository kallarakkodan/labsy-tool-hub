"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { HardDriveDownload, LogOut } from "lucide-react";

/*
 * A small header for authenticated admin pages — not `admin/layout.tsx`,
 * deliberately (see `admin/page.tsx`'s own comment): a shared layout would
 * also wrap `/admin/login`, and nav a signed-out visitor cannot use is a
 * worse surface than each authenticated page rendering this directly.
 *
 * The one thing every admin page actually needs a layout would have given it
 * for free — a way to sign out — so this exists to be repeated instead.
 */
export function AdminHeader() {
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    setSigningOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
    } finally {
      // Land on the public catalog, not the admin sign-in page — a signed-out
      // visitor is just a normal user again, and should be able to browse and
      // download without being shown an admin-only screen first.
      router.push("/");
      router.refresh();
    }
  }

  return (
    <div className="mb-6 flex items-center justify-between border-b border-border pb-4">
      <Link
        href="/"
        className="flex items-center gap-2 rounded-button focus-visible:outline-none
                   focus-visible:ring-2 focus-visible:ring-accent/35"
      >
        <HardDriveDownload className="size-4 text-accent" aria-hidden="true" />
        <span className="text-sm font-medium text-fg-muted">
          Internal Tool Hub <span className="text-fg-subtle">— Admin</span>
        </span>
      </Link>

      <button
        type="button"
        onClick={() => void signOut()}
        disabled={signingOut}
        className="flex items-center gap-1.5 rounded-button border border-border bg-surface px-3 py-1.5
                   text-xs text-fg transition-colors hover:border-border-hover hover:bg-surface-hover
                   focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/35
                   disabled:cursor-not-allowed disabled:opacity-50"
      >
        <LogOut className="size-3.5" aria-hidden="true" />
        Sign out
      </button>
    </div>
  );
}
