import Link from "next/link";

export default function ForbiddenPage() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-4 p-8 text-center">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        403 -- Not authorized
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Your account does not have access to this page.
      </p>
      <Link href="/" className="underline">
        Back to home
      </Link>
    </div>
  );
}
