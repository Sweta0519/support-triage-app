import { notFound } from "next/navigation";

import { requireProfile } from "@/app/lib/auth/session";
import {
  getMyTicketById,
  getTicketForStaff,
  isUuid,
  ALLOWED_STATUS_TRANSITIONS,
} from "@/app/lib/db/tickets";
import { listComments, type Comment } from "@/app/lib/db/comments";
import { getLatestTriageResult } from "@/app/lib/db/triage";
import { listStaffProfiles, type StaffProfile } from "@/app/lib/db/profiles";
import { getActiveShareForTicket } from "@/app/lib/db/shares";
import { Badge } from "@/app/components/Badge";
import { priorityBadgeClasses, statusBadgeClasses, statusLabel } from "@/app/lib/badges";
import { formatRelativeTime } from "@/app/lib/format";
import { CommentForm } from "./CommentForm";
import { StaffControls } from "./StaffControls";
import { TriagePanel } from "./TriagePanel";
import { SharePanel } from "./SharePanel";
import { parseQueueFilter, queueBreadcrumb } from "@/app/lib/queue-filters";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// Comments carry no display name, only author_id -- but combined with the
// ticket's own customer_id and the viewer's id, that's enough to label every
// comment without an extra query (RLS guarantees the only possible authors
// are the customer and staff).
function commentAuthorLabel(authorId: string, viewerId: string, customerId: string): string {
  if (authorId === viewerId) return "You";
  if (authorId === customerId) return "Customer";
  return "Support team";
}

export default async function TicketDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  // `from` is the queue tab the agent arrived from (set by the queue's
  // ticket links), so the breadcrumb can lead back to that same view.
  searchParams: Promise<{ from?: string | string[] }>;
}) {
  const { id } = await params;
  const { from } = await searchParams;
  const fromFilter = parseQueueFilter(from);
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
  const [comments, triage, staff, share] = await Promise.all([
    listComments(id, isStaff),
    isStaff ? getLatestTriageResult(id) : Promise.resolve(null),
    // Only admins reassign, so only admins get the staff list.
    isAdmin ? listStaffProfiles() : Promise.resolve([] as StaffProfile[]),
    isStaff ? getActiveShareForTicket(id) : Promise.resolve(null),
  ]);

  const ticketBody = (
    <div className="flex flex-col gap-2">
      <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
        Original message
      </h2>
      <p className="whitespace-pre-wrap rounded-xl border border-black/[.08] p-4 text-sm text-zinc-700 dark:border-white/[.145] dark:text-zinc-300">
        {ticket.body}
      </p>
    </div>
  );

  const commentsSection = (
    <div className="flex flex-col gap-4 border-t border-black/[.08] pt-6 dark:border-white/[.145]">
      <h2 className="text-sm font-semibold text-black dark:text-zinc-50">
        Comments{comments.length > 0 ? ` (${comments.length})` : ""}
      </h2>
      {comments.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">No comments yet.</p>
      ) : (
        <ul className="flex flex-col gap-4">
          {comments.map((comment: Comment) => {
            const label = commentAuthorLabel(comment.author_id, profile.id, ticket.customer_id);
            return (
              <li key={comment.id} className="flex gap-3">
                <span
                  className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-xs font-semibold ${
                    comment.is_internal
                      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
                      : "bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400"
                  }`}
                >
                  {label[0]}
                </span>
                <div
                  className={`flex flex-1 flex-col gap-1 rounded-lg border px-4 py-3 text-sm ${
                    comment.is_internal
                      ? "border-amber-300 bg-amber-50 dark:border-amber-900 dark:bg-amber-950/30"
                      : "border-black/[.08] dark:border-white/[.145]"
                  }`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="text-xs font-medium text-zinc-700 dark:text-zinc-300">
                      {label}
                    </span>
                    <span className="text-xs text-zinc-400 dark:text-zinc-600">
                      {formatRelativeTime(comment.created_at)}
                    </span>
                    {comment.is_internal ? (
                      <span className="rounded-full bg-amber-200/60 px-2 py-0.5 text-[10px] font-medium text-amber-800 dark:bg-amber-900/50 dark:text-amber-300">
                        Internal note
                      </span>
                    ) : null}
                  </div>
                  <p className="whitespace-pre-wrap text-zinc-700 dark:text-zinc-300">
                    {comment.body}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      )}
      <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
        <CommentForm
          ticketId={ticket.id}
          isStaff={isStaff}
          draft={isStaff ? (triage?.suggested_reply ?? null) : null}
        />
      </div>
    </div>
  );

  // Staff trace back through the queue tab they came from; customers
  // through their own list. The ticket itself is the current page.
  const parents = isStaff ? queueBreadcrumb(fromFilter) : [{ label: "My tickets", href: "/tickets" }];

  return (
    <div
      className={`mx-auto flex w-full flex-1 flex-col gap-6 p-8 ${isStaff ? "max-w-5xl" : "max-w-2xl"}`}
    >
      <div>
        <Breadcrumbs parents={parents} current={ticket.subject} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {ticket.subject}
            </h1>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              Opened {formatRelativeTime(ticket.created_at)}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {isStaff && ticket.triage_state?.priority ? (
              <Badge
                label={ticket.triage_state.priority}
                colorClasses={priorityBadgeClasses(ticket.triage_state.priority)}
              />
            ) : null}
            <Badge label={statusLabel(ticket.status)} colorClasses={statusBadgeClasses(ticket.status)} />
          </div>
        </div>
      </div>

      {isStaff ? (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
          <div className="flex min-w-0 flex-col gap-6">
            {ticketBody}
            {commentsSection}
          </div>
          <div className="flex flex-col gap-6 lg:sticky lg:top-8">
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
              triageStatus={ticket.triage_state?.triage_status ?? "pending"}
              triage={triage}
              fromFilter={fromFilter}
            />
            <SharePanel
              ticketId={ticket.id}
              share={share}
              siteUrl={SITE_URL}
              canPublish={Boolean(triage?.summary)}
            />
          </div>
        </div>
      ) : (
        <>
          {ticketBody}
          {commentsSection}
        </>
      )}
    </div>
  );
}
