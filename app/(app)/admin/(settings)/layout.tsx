import { AdminTabs } from "../AdminTabs";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { ADMIN_CRUMB } from "@/app/lib/crumbs";

const TABS = [
  { href: "/admin", label: "Overview" },
  { href: "/admin/workload", label: "Workload" },
  { href: "/admin/workspace", label: "Workspace" },
];

// Heading and tabs for the workspace settings pages. URLs stay /admin/...
// because (settings) is a route group.
export default function AdminSettingsLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div>
        <Breadcrumbs current={ADMIN_CRUMB.label} />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Admin</h1>
        <AdminTabs tabs={TABS} />
      </div>
      {children}
    </>
  );
}
