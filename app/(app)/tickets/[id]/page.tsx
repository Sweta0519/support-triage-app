import { notFound } from "next/navigation";

import { requireProfile } from "@/app/lib/auth/session";
import {
  getMyTicketById,
  getTicketForStaff,
  isUuid,
  ALLOWED_STATUS_TRANSITIONS,
} from "@/app/lib/db/tickets";
import { listComments } from "@/app/lib/db/comments";
import { getLatestTriageResult } from "@/app/lib/db/triage";
import { listStaffProfiles, type StaffProfile } from "@/app/lib/db/profiles";
import { CommentForm } from "./CommentForm";
import { StaffControls } from "./StaffControls";
import { TriagePanel } from "./TriagePanel";

export default async function TicketDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  const profile = await requireProfile();
  const isStaff = profile.role !== "customer";

  // Customers and staff go through entirely different queries -- a
  // customer's view is scoped to customer_id = them (RLS + app filter both
  // enforce this), a staff view relies on the agent/admin visibility rule
  // in tickets_select. Either path returning null renders as a plain 404,
  // never distinguishing "not yours" / "not assigned to you" from "doesn't
  // exist" to the caller.
  const ticket = isStaff
    ? await getTicketForStaff(id)
    : await getMyTicketById(profile.id, id);

  if (!ticket) {
    notFound();
  }

  // Triage output is staff-only (RLS enforces it too); customers never even
  // issue the query.
  const isAdmin = profile.role === "admin";
  const [comments, triage, staff] = await Promise.all([
    listComments(id, isStaff),
    isStaff ? getLatestTriageResult(id) : Promise.resolve(null),
    // Only admins reassign, so only admins get the staff list.
    isAdmin ? listStaffProfiles() : Promise.resolve([] as StaffProfile[]),
  ]);

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
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
      {/* Priority/category are seeded by the AI. Showing them to the customer
          would give anyone probing the triage prompt an instant feedback
          loop ("did my injected text make it urgent?"), so they're staff-only. */}
      {isStaff ? (
        <dl className="grid grid-cols-2 gap-2 text-xs text-zinc-500 dark:text-zinc-500">
          <dt>Priority</dt>
          <dd>{ticket.priority ?? "Not triaged yet"}</dd>
          <dt>Category</dt>
          <dd>{ticket.category ?? "Not triaged yet"}</dd>
        </dl>
      ) : null}

      {isStaff ? (
        <>
          <StaffControls
            ticketId={ticket.id}
            status={ticket.status}
            assigneeId={ticket.assignee_id}
            currentUserId={profile.id}
            allowedNext={ALLOWED_STATUS_TRANSITIONS[ticket.status]}
            isAdmin={isAdmin}
            staff={staff}
          />
          <TriagePanel
            ticketId={ticket.id}
            triageStatus={ticket.triage_status}
            triage={triage}
          />
        </>
      ) : null}

      <div className="flex flex-col gap-3 border-t border-black/[.08] pt-6 dark:border-white/[.145]">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
          Comments
        </h2>
        {comments.length === 0 ? (
          <p className="text-sm text-zinc-500 dark:text-zinc-500">
            No comments yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-3">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className={`rounded-lg border px-4 py-3 text-sm ${
                  comment.is_internal
                    ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                    : "border-black/[.08] dark:border-white/[.145]"
                }`}
              >
                {comment.is_internal ? (
                  <span className="mb-1 block text-xs font-medium text-amber-700 dark:text-amber-400">
                    Internal note
                  </span>
                ) : null}
                <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                  {comment.body}
                </p>
              </li>
            ))}
          </ul>
        )}
        <CommentForm
          ticketId={ticket.id}
          isStaff={isStaff}
          draft={isStaff ? (triage?.suggested_reply ?? null) : null}
        />
      </div>
    </div>
  );
}
