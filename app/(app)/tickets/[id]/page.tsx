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
import { getStaffEmail, listStaffProfiles, type StaffProfile } from "@/app/lib/db/profiles";
import { getActiveShareForTicket } from "@/app/lib/db/shares";
import { getPersonCards } from "@/app/lib/db/people";
import { personName, profileName, type PersonCard } from "@/app/lib/people";
import { Avatar } from "@/app/components/Avatar";
import { Badge } from "@/app/components/Badge";
import { SlaBanner } from "@/app/components/SlaBanner";
import { isFrustrated } from "@/app/lib/queue";
import { fieldLabel } from "@/app/lib/triage-fields";
import { priorityBadgeClasses, statusBadgeClasses, statusLabel } from "@/app/lib/badges";
import { formatRelativeTime, formatTicketNumber } from "@/app/lib/format";
import { computeSla } from "@/app/lib/sla";
import { CommentForm } from "./CommentForm";
import { StaffControls } from "./StaffControls";
import { RatingPanel } from "./RatingPanel";
import { getTicketRating } from "@/app/lib/db/ratings";
import { TriagePanel } from "./TriagePanel";
import { SharePanel } from "./SharePanel";
import { parseQueueFilter, queueBreadcrumb } from "@/app/lib/queue-filters";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { MY_TICKETS_CRUMB } from "@/app/lib/crumbs";
import { readablePageClass, widePageClass, chipClass } from "@/app/lib/styles";
import { effectiveTriageStatus } from "@/app/lib/triage-status";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { FlagIcon } from "@/app/components/FlagIcon";
import { listMyFlaggedTicketIds } from "@/app/lib/db/flags";
import { listLabels, listLabelsForTickets } from "@/app/lib/db/labels";
import { LabelsPanel } from "./LabelsPanel";
import { Stars } from "@/app/components/Stars";

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000";

// A comment's author by name where the viewer may see it (profile_cards,
// RLS-scoped), else by role: the only possible authors are the ticket's
// customer and staff. A customer sees staff as "<name> (Support)".
function commentAuthorLabel(
  authorId: string | null,
  viewerId: string,
  customerId: string,
  viewerIsStaff: boolean,
  people: Map<string, PersonCard>
): string {
  if (authorId === null) return "Deleted account";
  if (authorId === viewerId) return "You";
  const card = people.get(authorId);
  // A customer chooses their own name ("Support Team" included), so staff
  // always see it marked as the customer.
  if (authorId === customerId) return card?.display_name ? `${card.display_name} (Customer)` : "Customer";
  if (!card?.display_name) return "Support team";
  return viewerIsStaff ? card.display_name : `${card.display_name} (Support)`;
}

const headerChip = chipClass;
const outlineChip = `${headerChip} border border-black/[.08] capitalize text-zinc-600 dark:border-white/[.145] dark:text-zinc-400`;

// The triage frustration score (1-5) in the triage prompt's own words
// ("1 calm, 3 annoyed, 5 furious"); isFrustrated() is the same 4+
// threshold the queue card uses.
function frustrationLabel(score: number): string {
  return isFrustrated(score) ? "Frustrated" : score === 3 ? "Annoyed" : "Calm";
}
function frustrationTone(score: number): string {
  return isFrustrated(score)
    ? "bg-orange-100 text-orange-800 dark:bg-orange-950/50 dark:text-orange-300"
    : score === 3
      ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300"
      : "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-300";
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
  const filedByOther = isStaff && ticket.created_by !== null && ticket.created_by !== profile.id;
  const showRating = ticket.status === "resolved" || ticket.status === "closed";
  // Names and pictures of everyone on the page the viewer may see; chained
  // off the comments (for their authors) so it runs alongside the rest.
  const commentsWithPeople = listComments(id, isStaff).then(async (list) => ({
    comments: list,
    people: await getPersonCards([ticket.customer_id, ticket.created_by, ...list.map((c: Comment) => c.author_id)]),
  }));
  const [{ comments, people }, triage, staff, share, filerEmail, rating, flaggedByMe, labels] = await Promise.all([
    commentsWithPeople,
    isStaff ? getLatestTriageResult(id) : Promise.resolve(null),
    // Only admins reassign, so only admins get the staff list.
    isAdmin ? listStaffProfiles() : Promise.resolve([] as StaffProfile[]),
    isStaff ? getActiveShareForTicket(id) : Promise.resolve(null),
    filedByOther ? getStaffEmail(ticket.created_by as string) : Promise.resolve(null),
    // RLS decides who sees it: the customer, an admin, or the credited agent.
    showRating ? getTicketRating(id) : Promise.resolve(null),
    // The viewer's own follow-up flag (staff only; private to them).
    isStaff ? listMyFlaggedTicketIds().then((ids) => ids.has(ticket.id)) : Promise.resolve(false),
    // Team labels (SUP-39): the team's list and this ticket's, staff only.
    isStaff
      ? Promise.all([listLabels(), listLabelsForTickets([ticket.id])]).then(([all, byTicket]) => ({
          all,
          applied: (byTicket.get(ticket.id) ?? []).map((l) => l.id),
        }))
      : Promise.resolve(null),
  ]);
  const customerCard = people.get(ticket.customer_id);

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
            const label = commentAuthorLabel(comment.author_id, profile.id, ticket.customer_id, isStaff, people);
            const author = comment.author_id ? people.get(comment.author_id) : undefined;
            return (
              <li key={comment.id} className="flex gap-3">
                {comment.author_id ? (
                  <Avatar
                    id={comment.author_id}
                    name={comment.author_id === profile.id ? profileName(profile) : (author?.display_name ?? null)}
                    avatarPath={comment.author_id === profile.id ? profile.avatar_path : (author?.avatar_path ?? null)}
                  />
                ) : (
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-zinc-100 text-xs font-semibold text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
                    ?
                  </span>
                )}
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
  const parents = isStaff ? queueBreadcrumb(fromFilter) : [MY_TICKETS_CRUMB];
  // A ticket staff logged for the customer (phone, chat, email) says so.
  // The customer's page names "our support team" rather than the person:
  // that's a UI choice (created_by is an opaque id they could still read,
  // like assignee_id), and it's what a customer needs to know.
  // Staff only see this line with a name; customers get the team.
  const filedBy = !ticket.created_by
    ? null
    : !isStaff
      ? "Filed by our support team on your behalf"
      : ticket.created_by === profile.id
        ? "Filed by you on the customer's behalf"
        : `Filed by ${personName(people.get(ticket.created_by), filerEmail ?? "a former staff member")} on the customer's behalf`;
  // Staff only: the response target is an internal commitment.
  const sla = isStaff ? computeSla(ticket) : null;

  return (
    <div className={isStaff ? widePageClass : readablePageClass}>
      <div>
        <Breadcrumbs parents={parents} current={ticket.subject} />
        <div className="mt-2 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">
              {ticket.subject}
            </h1>
            {isStaff ? (
              // Who this is from: their name and picture where they've set
              // one (profile_cards -- staff never see a customer's email).
              <p className="mt-2 flex items-center gap-2 text-sm text-zinc-700 dark:text-zinc-300">
                <Avatar
                  id={ticket.customer_id}
                  name={customerCard?.display_name ?? null}
                  avatarPath={customerCard?.avatar_path ?? null}
                  size={24}
                />
                <span>
                  {customerCard?.display_name ? (
                    <>
                      <span className="text-zinc-500 dark:text-zinc-400">Customer:</span> {customerCard.display_name}
                    </>
                  ) : (
                    "Customer"
                  )}
                </span>
              </p>
            ) : null}
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-500">
              <span className="font-mono">{formatTicketNumber(ticket.number)}</span>
              {flaggedByMe ? (
                <span className="ml-1.5 inline-flex align-middle">
                  <FlagIcon size={12} />
                </span>
              ) : null}{" "}
              · Opened{" "}
              {formatRelativeTime(ticket.created_at)}
              {filedBy ? <> · {filedBy}</> : null}
            </p>
            {isStaff && (triage?.is_escalation_risk || triage?.frustration != null) ? (
              // The AI's read of the customer, up front: it's what decides
              // how carefully to word the first reply. AI-estimated, and
              // labelled as such.
              <div role="group" className="mt-2 flex flex-wrap items-center gap-1.5 text-xs" aria-label="AI-estimated customer sentiment">
                {triage.is_escalation_risk ? (
                  <span className={`${headerChip} bg-red-100 text-red-800 dark:bg-red-950/50 dark:text-red-300`}>
                    Escalation risk
                  </span>
                ) : null}
                {triage.frustration != null ? (
                  <span className={`${headerChip} ${frustrationTone(triage.frustration)}`}>
                    {frustrationLabel(triage.frustration)} {triage.frustration}/5
                  </span>
                ) : null}
                <span className="text-zinc-500 dark:text-zinc-400">AI-estimated</span>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap items-center justify-end gap-2">
            {isStaff && ticket.triage_state?.category ? (
              <span className={outlineChip}>
                {fieldLabel(ticket.triage_state.category)}
              </span>
            ) : null}
            {isStaff && ticket.triage_state?.team ? (
              <span className={outlineChip}>
                {ticket.triage_state.team} team
              </span>
            ) : null}
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

      {sla ? <SlaBanner sla={sla} /> : null}

      {isStaff ? (
        <div
          // The reading column (ticket body, comments) stops at a readable
          // line length on wide screens; the side panel sits beside it.
          className="grid gap-6 lg:grid-cols-[minmax(0,48rem)_320px] lg:items-start"
        >
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
            {labels ? <LabelsPanel ticketId={ticket.id} allLabels={labels.all} appliedIds={labels.applied} /> : null}
            {rating ? (
              <section className="flex flex-col gap-1 rounded-xl border border-black/[.08] p-4 text-sm dark:border-white/[.145]">
                <h2 className="text-xs font-semibold uppercase tracking-wide text-zinc-400 dark:text-zinc-600">
                  Customer rating
                </h2>
                <p className="flex items-center gap-2 text-zinc-700 dark:text-zinc-300">
                  <Stars score={rating.score} />
                  <span aria-hidden>{rating.score} of 5</span>
                </p>
                {rating.comment ? (
                  <p className="text-zinc-600 dark:text-zinc-400">“{rating.comment}”</p>
                ) : null}
              </section>
            ) : null}
            <TriagePanel
              ticketId={ticket.id}
              triageStatus={effectiveTriageStatus(ticket.triage_state, { aiConfigured: isAiConfigured() })}
              aiConfigured={isAiConfigured()}
              triage={triage}
              triageState={ticket.triage_state}
              currentUserId={profile.id}
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
          {showRating ? (
            <RatingPanel
              ticketId={ticket.id}
              rating={rating ? { score: rating.score, comment: rating.comment } : null}
              editable={ticket.status === "resolved"}
            />
          ) : null}
          {commentsSection}
        </>
      )}
    </div>
  );
}
