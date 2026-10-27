import { AdminNav } from "./AdminNav";
import { requireAdmin } from "@/app/lib/auth/session";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { ADMIN_CRUMB } from "@/app/lib/crumbs";
import { widePageClass } from "@/app/lib/styles";

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
    <div className={widePageClass}>
      <div>
        <Breadcrumbs current={ADMIN_CRUMB.label} />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Admin</h1>
        <AdminNav />
      </div>
      {children}
    </div>
  );
}
