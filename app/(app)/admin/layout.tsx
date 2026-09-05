import Link from "next/link";

import { requireAdmin } from "@/app/lib/auth/session";

const navLinkClasses =
  "rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/[.05] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-50";

// Route-segment guard: every page under /admin requires the admin role,
// verified server-side. Pages still call requireAdmin() themselves where
// they read data, and RLS is the final line -- this layout is the first
// gate, not the only one.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Admin</h1>
        <nav className="mt-3 flex items-center gap-1">
          <Link href="/admin" className={navLinkClasses}>
            Overview
          </Link>
          <Link href="/admin/users" className={navLinkClasses}>
            Users
          </Link>
          <Link href="/queue" className={navLinkClasses}>
            Queue
          </Link>
        </nav>
      </div>
      {children}
    </div>
  );
}
