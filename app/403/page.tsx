import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-100 text-lg font-semibold text-red-700 dark:bg-red-950/40 dark:text-red-400">
        !
      </span>
      <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Not authorized</h1>
      <p className="max-w-xs text-sm text-zinc-500 dark:text-zinc-500">
        Your account does not have access to this page.
      </p>
      <Link href="/" className="text-sm font-medium text-indigo-600 hover:underline dark:text-indigo-400">
        Back to home
      </Link>
    </div>
  );
}
