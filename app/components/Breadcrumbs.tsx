import Link from "next/link";

export type Crumb = { label: string; href?: string };

// "Queue / Mine / <ticket>" -- every segment but the last is a link, so a
// staff member can jump back to the exact queue tab they came from, or to
// the whole queue, in one click. The last segment is the current page.
export function Breadcrumbs({ items }: { items: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb">
      <ol className="flex flex-wrap items-center gap-1.5 text-xs text-zinc-500 dark:text-zinc-500">
        {items.map((item, index) => {
          const last = index === items.length - 1;
          return (
            <li key={`${item.label}-${index}`} className="flex min-w-0 items-center gap-1.5">
              {index > 0 ? (
                <span aria-hidden="true" className="text-zinc-300 dark:text-zinc-700">
                  /
                </span>
              ) : null}
              {item.href && !last ? (
                <Link
                  href={item.href}
                  className="font-medium text-indigo-600 hover:underline dark:text-indigo-400"
                >
                  {item.label}
                </Link>
              ) : (
                <span
                  aria-current={last ? "page" : undefined}
                  className="max-w-[18rem] truncate font-medium text-zinc-700 dark:text-zinc-300"
                  title={item.label}
                >
                  {item.label}
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
