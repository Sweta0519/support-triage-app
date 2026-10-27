"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const navLinkClasses =
  "rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/[.05] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-50";

export function AdminNav() {
  const pathname = usePathname();
  // The sidebar lists Access requests separately from Admin, so that page
  // only shows the two tabs that belong together: Users and Access requests.
  const onAccessRequests =
    pathname === "/admin/access-requests" ||
    pathname.startsWith("/admin/access-requests/");

  return (
    <nav className="mt-3 flex items-center gap-1">
      {!onAccessRequests && (
        <Link href="/admin" className={navLinkClasses}>
          Overview
        </Link>
      )}
      <Link href="/admin/users" className={navLinkClasses}>
        Users
      </Link>
      <Link href="/admin/access-requests" className={navLinkClasses}>
        Access requests
      </Link>
      {!onAccessRequests && (
        <>
          <Link href="/admin/workload" className={navLinkClasses}>
            Workload
          </Link>
          <Link href="/admin/workspace" className={navLinkClasses}>
            Workspace
          </Link>
        </>
      )}
    </nav>
  );
}
