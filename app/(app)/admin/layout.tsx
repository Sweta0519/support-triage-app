import Link from "next/link";

import { requireAdmin } from "@/app/lib/auth/session";

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
      <nav className="flex items-center gap-4 text-sm">
        <span className="font-semibold text-black dark:text-zinc-50">Admin</span>
        <Link href="/admin" className="underline">
          Overview
        </Link>
        <Link href="/admin/users" className="underline">
          Users
        </Link>
        <Link href="/queue" className="underline">
          Queue
        </Link>
      </nav>
      {children}
    </div>
  );
}
