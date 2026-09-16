import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmEmail?: string; error?: string; deleted?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Sign in</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Welcome back -- enter your details to continue.
        </p>
      </div>
      {params.confirmEmail ? (
        <p className="w-full rounded-lg bg-sky-50 px-3 py-2 text-center text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
          Check your email for a confirmation link before signing in.
        </p>
      ) : null}
      {params.deleted ? (
        <p className="w-full rounded-lg bg-sky-50 px-3 py-2 text-center text-sm text-sky-800 dark:bg-sky-950/40 dark:text-sky-300">
          Your account and its data have been deleted.
        </p>
      ) : null}
      {params.error === "confirmation-failed" ? (
        <p className="w-full rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700 dark:bg-red-950/40 dark:text-red-400">
          That confirmation link is invalid or has expired.
        </p>
      ) : null}
      <LoginForm />
    </div>
  );
}
