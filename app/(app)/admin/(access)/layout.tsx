import { AdminTabs } from "../AdminTabs";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";

const TABS = [
  { href: "/admin/users", label: "Users" },
  { href: "/admin/access-requests", label: "Access requests" },
];

// The sidebar lists Access requests separately from Admin, so these pages
// get their own heading and just the two tabs that belong together.
export default function AdminAccessLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <div>
        <Breadcrumbs current="Access requests" />
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">
          Access requests
        </h1>
        <AdminTabs tabs={TABS} />
      </div>
      {children}
    </>
  );
}
