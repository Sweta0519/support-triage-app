import { requireAdmin } from "@/app/lib/auth/session";
import { widePageClass } from "@/app/lib/styles";

// Route-segment guard: every page under /admin requires the admin role,
// verified server-side. Pages still call requireAdmin() themselves where
// they read data, and RLS is the final line -- this layout is the first
// gate, not the only one. The heading and tabs live in the (settings) and
// (access) route-group layouts below.
export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireAdmin();

  return <div className={widePageClass}>{children}</div>;
}
