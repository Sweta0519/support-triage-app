import { notFound } from "next/navigation";

import { requireProfile } from "@/app/lib/auth/session";
import { getMyTicketById } from "@/app/lib/db/tickets";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!UUID_RE.test(id)) {
    notFound();
  }

  const profile = await requireProfile();
  // getMyTicketById filters by customer_id server-side (backed by RLS too),
  // so a ticket belonging to another user comes back as null here -- it
  // renders as a plain 404, never distinguishing "not yours" from "doesn't
  // exist" to the caller.
  const ticket = await getMyTicketById(profile.id, id);

  if (!ticket) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-4 p-8">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
          {ticket.subject}
        </h1>
        <span className="rounded-full border border-black/[.08] px-3 py-1 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
          {ticket.status}
        </span>
      </div>
      <p className="whitespace-pre-wrap text-sm text-zinc-700 dark:text-zinc-300">
        {ticket.body}
      </p>
      <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500 dark:text-zinc-500">
        <dt>Priority</dt>
        <dd>{ticket.priority ?? "Not triaged yet"}</dd>
        <dt>Category</dt>
        <dd>{ticket.category ?? "Not triaged yet"}</dd>
      </dl>
    </div>
  );
}
