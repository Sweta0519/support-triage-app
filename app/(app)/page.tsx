import { requireProfile } from "@/app/lib/auth/session";
import { signOutAction } from "@/app/lib/auth/actions";

export default async function HomePage() {
  const profile = await requireProfile();

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col items-start gap-4 p-8">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
        Support Ticket Triage
      </h1>
      <p className="text-sm text-zinc-600 dark:text-zinc-400">
        Signed in as <span className="font-medium">{profile.email}</span> --
        role: <span className="font-medium">{profile.role}</span>
      </p>
      <p className="text-sm text-zinc-500 dark:text-zinc-500">
        Ticket creation, the agent queue, and admin views land in later
        milestones.
      </p>
      <form action={signOutAction}>
        <button
          type="submit"
          className="rounded-full border border-black/[.08] px-5 py-2 text-sm font-medium transition-colors hover:bg-black/[.05] dark:border-white/[.145] dark:hover:bg-white/[.06]"
        >
          Sign out
        </button>
      </form>
    </div>
  );
}
