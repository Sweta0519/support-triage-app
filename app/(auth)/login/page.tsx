import { LoginForm } from "./LoginForm";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ confirmEmail?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="flex w-full max-w-sm flex-col items-center gap-6">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Sign in
      </h1>
      {params.confirmEmail ? (
        <p className="text-center text-sm text-zinc-600 dark:text-zinc-400">
          Check your email for a confirmation link before signing in.
        </p>
      ) : null}
      {params.error === "confirmation-failed" ? (
        <p className="text-center text-sm text-red-600 dark:text-red-400">
          That confirmation link is invalid or has expired.
        </p>
      ) : null}
      <LoginForm />
    </div>
  );
}
