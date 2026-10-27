import Link from "next/link";

const navLinkClasses =
  "rounded-full px-3 py-1.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-black/[.05] hover:text-black dark:text-zinc-400 dark:hover:bg-white/[.06] dark:hover:text-zinc-50";

// The pill tabs under an admin page heading. Each route group's layout
// passes its own set, so the tabs never depend on the current pathname.
export function AdminTabs({ tabs }: { tabs: { href: string; label: string }[] }) {
  return (
    <nav className="mt-3 flex items-center gap-1">
      {tabs.map((tab) => (
        <Link key={tab.href} href={tab.href} className={navLinkClasses}>
          {tab.label}
        </Link>
      ))}
    </nav>
  );
}
