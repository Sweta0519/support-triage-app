import Link from "next/link";

import { requireAdmin } from "@/app/lib/auth/session";
import { AccessRequestActions } from "@/app/components/AccessRequestActions";
import { listAccessRequests, type AccessRequest } from "@/app/lib/db/access-requests";
import { getPersonCards } from "@/app/lib/db/people";
import { formatRelativeTime, formatTicketNumber } from "@/app/lib/format";
import { linkClass } from "@/app/lib/styles";

const card = "rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]";
const muted = "text-xs text-zinc-500 dark:text-zinc-400";

// The answers from the request's ticket, without its fixed first line.
function answers(request: AccessRequest): string | null {
  const body = request.ticket?.body;
  if (!body) return null;
  return body.replace(/^I'd like access to Support Triage for my team\.\s*/, "");
}

// Access requests (SUP-68): everyone who asked through "Request access",
// waiting ones first with Grant and Decline, then the history.
export default async function AccessRequestsPage() {
  await requireAdmin();
  const requests = await listAccessRequests();
  const pending = requests.filter((r) => r.status === "pending");
  const handled = requests.filter((r) => r.status !== "pending");
  const deciders = await getPersonCards(handled.map((r) => r.decidedBy));

  return (
    <div className="flex max-w-3xl flex-col gap-8">
      <section aria-labelledby="pending" className="flex flex-col gap-3">
        <h2 id="pending" className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">
          Waiting ({pending.length})
        </h2>
        {pending.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No one is waiting for access.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {pending.map((r) => {
              const name = r.name ?? r.email;
              const text = answers(r);
              return (
                <li key={r.userId} className={card} aria-label={`Request from ${name}`}>
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <p className="font-medium text-black dark:text-zinc-50">
                      {name}
                      {r.name ? <span className="ml-2 text-sm font-normal text-zinc-500">{r.email}</span> : null}
                    </p>
                    <p className={muted}>
                      Asked {formatRelativeTime(r.requestedAt)}
                      {r.ticket ? (
                        <>
                          {" · "}
                          <Link href={`/tickets/${r.ticket.id}`} className={linkClass}>
                            {formatTicketNumber(r.ticket.number)}
                          </Link>
                        </>
                      ) : null}
                    </p>
                  </div>
                  {text ? (
                    <p className="mt-2 whitespace-pre-line text-sm text-zinc-700 dark:text-zinc-300">{text}</p>
                  ) : null}
                  {r.role !== "customer" ? (
                    <p className={`mt-2 ${muted}`}>Already {r.role === "admin" ? "an admin" : "an agent"}.</p>
                  ) : null}
                  <div className="mt-3">
                    <AccessRequestActions userId={r.userId} name={name} />
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section aria-labelledby="handled" className="flex flex-col gap-3">
        <h2 id="handled" className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">
          Handled ({handled.length})
        </h2>
        {handled.length === 0 ? (
          <p className="text-sm text-zinc-600 dark:text-zinc-400">No decisions yet.</p>
        ) : (
          <ul aria-label="Handled requests" className="divide-y divide-black/[.06] rounded-xl border border-black/[.08] dark:divide-white/[.08] dark:border-white/[.145]">
            {handled.map((r) => {
              const decider = r.decidedBy ? (deciders.get(r.decidedBy)?.display_name ?? "An admin") : "An admin";
              return (
                <li key={r.userId} className="flex flex-wrap items-baseline justify-between gap-2 px-4 py-3 text-sm">
                  <span className="text-black dark:text-zinc-50">{r.name ?? r.email}</span>
                  <span className={muted}>
                    {r.status === "granted" ? "Granted" : "Declined"} by {decider}
                    {r.decidedAt ? ` ${formatRelativeTime(r.decidedAt)}` : ""}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
