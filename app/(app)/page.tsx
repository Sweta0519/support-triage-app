import Link from "next/link";

import { requireProfile } from "@/app/lib/auth/session";
import { listMyTickets, listQueueTickets } from "@/app/lib/db/tickets";

function DashboardCard({
  href,
  title,
  description,
  stat,
}: {
  href: string;
  title: string;
  description: string;
  stat: string;
}) {
  return (
    <Link
      href={href}
      className="group flex flex-col gap-3 rounded-xl border border-black/[.08] p-5 transition-colors hover:border-indigo-300 hover:bg-indigo-50/40 dark:border-white/[.145] dark:hover:border-indigo-900 dark:hover:bg-indigo-950/20"
    >
      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">{title}</h2>
        <span className="text-2xl font-semibold text-indigo-600 dark:text-indigo-400">{stat}</span>
      </div>
      <p className="text-xs text-zinc-500 dark:text-zinc-500">{description}</p>
      <span className="text-xs font-medium text-indigo-600 group-hover:underline dark:text-indigo-400">
        Open &rarr;
      </span>
    </Link>
  );
}

export default async function HomePage() {
  const profile = await requireProfile();
  const isStaff = profile.role !== "customer";

  const [myTickets, queue] = await Promise.all([
    !isStaff ? listMyTickets(profile.id) : Promise.resolve([]),
    isStaff ? listQueueTickets(profile.id, profile.role) : Promise.resolve([]),
  ]);
  const openTicketCount = myTickets.filter((t) => t.status !== "closed").length;
  const unassignedCount = queue.filter((t) => t.assignee_id === null).length;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {isStaff ? "Dashboard" : "Welcome back"}
        </h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          {isStaff
            ? "An AI triage agent assesses every ticket the moment it's filed."
            : "Track your support requests here, or file a new one."}
        </p>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {!isStaff ? (
          <>
            <DashboardCard
              href="/tickets"
              title="My tickets"
              description="View and follow up on your support requests."
              stat={String(openTicketCount)}
            />
            <Link
              href="/tickets/new"
              className="flex flex-col items-start justify-center gap-2 rounded-xl border border-dashed border-black/[.15] p-5 text-sm font-medium text-indigo-600 transition-colors hover:border-indigo-400 hover:bg-indigo-50/40 dark:border-white/[.2] dark:text-indigo-400 dark:hover:border-indigo-800 dark:hover:bg-indigo-950/20"
            >
              + New ticket
              <span className="text-xs font-normal text-zinc-500 dark:text-zinc-500">
                Describe what&apos;s going on and we&apos;ll take it from there.
              </span>
            </Link>
          </>
        ) : (
          <>
            <DashboardCard
              href="/queue"
              title="Queue"
              description="Tickets assigned to you or waiting to be claimed."
              stat={String(queue.length)}
            />
            <DashboardCard
              href="/queue"
              title="Unassigned"
              description="Nobody has claimed these yet."
              stat={String(unassignedCount)}
            />
            {profile.role === "admin" ? (
              <DashboardCard
                href="/admin"
                title="Admin"
                description="Users, roles, and AI triage performance."
                stat="→"
              />
            ) : null}
          </>
        )}
      </div>
    </div>
  );
}
