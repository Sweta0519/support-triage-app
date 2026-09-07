import Link from "next/link";

import { linkClass } from "@/app/lib/styles";

export type CrumbLink = { label: string; href: string };

// Generic breadcrumb trail: every parent is a link, the current page is
// plain text (`aria-current="page"`) that fills whatever width is left and
// truncates with a tooltip. Callers decide the trail; this only renders it.
export function Breadcrumbs({ parents, current }: { parents: CrumbLink[]; current: string }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-nowrap items-center gap-1.5 text-xs">
        {parents.map((crumb) => (
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
