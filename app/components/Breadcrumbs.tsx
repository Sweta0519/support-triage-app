import Link from "next/link";

import { linkClass } from "@/app/lib/styles";

export type CrumbLink = { label: string; href: string };

// Every trail starts at the dashboard, so top-level pages (Queue, Notes) get
// a one-link trail and deeper pages inherit the same root automatically.
const HOME: CrumbLink = { label: "Home", href: "/" };

// Generic breadcrumb trail: Home, then every parent as a link, then the
// current page as plain text (`aria-current="page"`) that fills whatever
// width is left and truncates with a tooltip. Callers decide the trail
// below Home; this only renders it.
export function Breadcrumbs({ parents, current }: { parents: CrumbLink[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-nowrap items-center gap-1.5 text-xs">
        {[HOME, ...parents].map((crumb) => (
          <li key={crumb.href} className="flex shrink-0 items-center gap-1.5">
            <Link href={crumb.href} className={linkClass}>
              {crumb.label}
            </Link>
            <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
              /
            </span>
          </li>
        ))}
        <li className="min-w-0">
          <span
            aria-current="page"
            title={current}
            className="block truncate font-medium text-zinc-700 dark:text-zinc-300"
          >
            {current}
          </span>
        </li>
      </ol>
    </nav>
  );
}
