import Link from "next/link";

import { linkClass } from "@/app/lib/styles";
import { HOME_CRUMB, type CrumbLink } from "@/app/lib/crumbs";

export type { CrumbLink };

// Generic breadcrumb trail: Home, then every parent as a link, then the
// current page as plain text (`aria-current="page"`) that fills whatever
// width is left and truncates with a tooltip. Every trail starts at the
// dashboard, so a top-level page passes just `current`; callers decide the
// trail below Home, this only renders it.
export function Breadcrumbs({
  parents = [],
  current,
}: {
  parents?: CrumbLink[];
  current: string;
}) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-nowrap items-center gap-1.5 text-xs">
        {[HOME_CRUMB, ...parents].map((crumb) => (
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
