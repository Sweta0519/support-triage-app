import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import { addComment, COMMENT_MAX_LENGTH, listComments } from "@/app/lib/db/comments";
import { listMyFlaggedTicketIds } from "@/app/lib/db/flags";
import { listLabelsForTickets } from "@/app/lib/db/labels";
import { getPersonCards } from "@/app/lib/db/people";
import type { Profile } from "@/app/lib/db/profiles";
import { RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import {
  claimTicket,
  getTicketForStaffByNumber,
  getTicketNumbers,
  listQueueTickets,
  TICKET_STATUSES,
  type Ticket,
} from "@/app/lib/db/tickets";
import { getLatestTriageResult, reviewTriage, TriageReviewError } from "@/app/lib/db/triage";
import { formatTicketNumber } from "@/app/lib/format";
import type { PersonCard } from "@/app/lib/people";
import { matchesSearch, QUEUE_SORTS, QUEUE_STATUSES, sortQueue, type QueueSort } from "@/app/lib/queue";
import { computeSla } from "@/app/lib/sla";
import { SITE_URL } from "@/app/lib/site-url";
import { moveTicketAs } from "@/app/lib/ticket-moves";
import { isOneOf, TRIAGE_CATEGORIES, TRIAGE_PRIORITIES, TRIAGE_TEAMS } from "@/app/lib/triage-fields";
import { guarded, toolError, toolResult, untrusted } from "./results";

// The staff tools (SUP-56): the queue, a ticket with the AI's triage, and
// the actions an agent takes on it, through the same app/lib/db/ functions
// and rules as the web app, running as the staff member under RLS (agents
// see their own and unassigned tickets, admins every ticket).
//
// Triage stays advisory: the AI's draft reply comes back as a suggestion,
// and nothing reaches a customer unless the assistant calls post_reply,
// which is a staff action like "Add comment". Admin-only actions (role
// changes, learning exclusions) aren't offered.

const QUEUE_TABS = ["all", "unassigned", "mine", "flagged"] as const;
const LIST_LIMIT = 50;

const ticketNumber = z
  .number()
  .int()
  .positive()
  .describe("The ticket's number, without the #: 1042 for ticket #1042.");

// Same answer for a ticket that doesn't exist and one this person can't see
// (an agent and another agent's ticket), as on the web.
const notFound = (number: number) =>
  toolError(`Ticket ${formatTicketNumber(number)} isn't available to you. Use list_queue to see your queue.`);

function personRef(id: string | null, viewerId: string, people: Map<string, PersonCard>) {
  if (id === null) return null;
  if (id === viewerId) return { you: true };
  const name = people.get(id)?.display_name;
  return name ? { name: untrusted(name) } : { name: null };
}

export function registerStaffTools(server: McpServer, profile: Profile) {
  server.registerTool(
    "list_queue",
    {
      title: "List the support queue",
      description:
        "The open support queue as the signed-in staff member sees it on /queue: the same tabs, status filter, " +
        "search and sorting, with each ticket's response-time (SLA) state and the AI's flags. " +
        `At most ${LIST_LIMIT} tickets; "more" says how many others match.`,
      inputSchema: {
        tab: z
          .enum(QUEUE_TABS)
          .optional()
          .describe('"all" (default), "unassigned", "mine" (assigned to you), or "flagged" (your follow-up flags).'),
        status: z.enum(QUEUE_STATUSES).optional().describe("Only tickets with this status. Closed tickets are never in the queue."),
        sort: z
          .enum(Object.keys(QUEUE_SORTS) as [QueueSort, ...QueueSort[]])
          .optional()
          .describe('"sla" (default: most urgent first), "newest" or "oldest".'),
        search: z
          .string()
          .max(200)
          .optional()
          .describe('Matches the number ("#1042"), subject, AI summary, category or team.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ tab = "all", status, sort = "sla", search = "" }) => {
      const [all, flagged] = await Promise.all([
        listQueueTickets(profile.id, profile.role),
        tab === "flagged" ? listMyFlaggedTicketIds() : Promise.resolve(new Set<string>()),
      ]);
      const now = new Date();
      const matching = sortQueue(
        all.filter(
          (t) =>
            (tab === "all" ||
              (tab === "unassigned" && t.assignee_id === null) ||
              (tab === "mine" && t.assignee_id === profile.id) ||
              (tab === "flagged" && flagged.has(t.id))) &&
            (!status || t.status === status) &&
            matchesSearch(t, search.trim())
        ),
        sort,
        now
      );
      const shown = matching.slice(0, LIST_LIMIT);
      const people = await getPersonCards(shown.map((t) => t.assignee_id));
      return toolResult({
        tickets: shown.map((t) => {
          const sla = computeSla(t, now);
          return {
            number: formatTicketNumber(t.number),
            subject: untrusted(t.subject),
            status: t.status,
            assignee: personRef(t.assignee_id, profile.id, people),
            priority: t.triage_state?.priority ?? null,
            category: t.triage_state?.category ?? null,
            team: t.triage_state?.team ?? null,
            sla: sla ? { state: sla.state, due_at: sla.dueAt.toISOString() } : null,
            ai: t.latest_triage
              ? {
                  summary: untrusted(t.latest_triage.summary),
                  escalation_risk: t.latest_triage.is_escalation_risk,
                  needs_human_review: t.latest_triage.needs_human_review,
                }
              : null,
            created_at: t.created_at,
          };
        }),
        ...(matching.length > shown.length ? { more: matching.length - shown.length } : {}),
      });
    })
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Read a ticket (staff view)",
      description:
        "One ticket as staff see it: the customer's message, the whole conversation including internal notes, " +
        "team labels, and the AI's triage (category, priority and why, team, duplicate or related tickets, " +
        "escalation risk, what's still needed, and a draft reply). The draft is a suggestion only: nothing is " +
        "sent to the customer unless you call post_reply.",
      inputSchema: { number: ticketNumber },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    guarded(async ({ number }) => {
      const ticket = await getTicketForStaffByNumber(number);
      if (!ticket) return notFound(number);
      const [comments, triage, labels] = await Promise.all([
        listComments(ticket.id, true),
        getLatestTriageResult(ticket.id),
        listLabelsForTickets([ticket.id]),
      ]);
      const linked = triage ? [triage.duplicate_of, ...triage.related_ticket_ids].filter((id): id is string => id !== null) : [];
      const [people, numbers] = await Promise.all([
        getPersonCards([ticket.customer_id, ticket.assignee_id, ...comments.map((c) => c.author_id)]),
        getTicketNumbers(linked),
      ]);
      const asNumber = (id: string) => (numbers.has(id) ? formatTicketNumber(numbers.get(id)!) : null);
      const state = ticket.triage_state;
      return toolResult({
        number: formatTicketNumber(ticket.number),
        subject: untrusted(ticket.subject),
        status: ticket.status,
        customer: personRef(ticket.customer_id, profile.id, people),
        assignee: personRef(ticket.assignee_id, profile.id, people),
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        description: untrusted(ticket.body),
        labels: (labels.get(ticket.id) ?? []).map((l) => untrusted(l.name)),
        triage: {
          status: state?.triage_status ?? "pending",
          // The working values: the AI's, or a reviewer's correction.
          priority: state?.priority ?? null,
          category: state?.category ?? null,
          team: state?.team ?? null,
          reviewed: state?.reviewed_at != null,
          ...(triage
            ? {
                summary: untrusted(triage.summary),
                priority_reason: triage.priority_reason ? untrusted(triage.priority_reason) : null,
                escalation_risk: triage.is_escalation_risk,
                frustration: triage.frustration,
                needs_human_review: triage.needs_human_review,
                // Only links this person can open come back as numbers.
                duplicate_of: triage.duplicate_of ? asNumber(triage.duplicate_of) : null,
                related: triage.related_ticket_ids.map(asNumber).filter((n): n is string => n !== null),
                still_needed: triage.missing_info.map((m) => untrusted(m)),
                draft_reply: triage.suggested_reply
                  ? { suggestion_only: true, text: untrusted(triage.suggested_reply) }
                  : null,
              }
            : {}),
        },
        conversation: comments.map((c) => ({
          from: personRef(c.author_id, profile.id, people) ?? { name: null },
          by_customer: c.author_id === ticket.customer_id,
          internal: c.is_internal,
          at: c.created_at,
          message: untrusted(c.body),
        })),
        url: `${SITE_URL}/tickets/${ticket.id}`,
      });
    })
  );

  server.registerTool(
    "claim_ticket",
    {
      title: "Claim a ticket",
      description:
        "Assigns an unassigned ticket to you, as the Claim button does. If someone else claims it first, " +
        "this says so instead.",
      inputSchema: { number: ticketNumber },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ number }) => {
      const ticket = await getTicketForStaffByNumber(number);
      if (!ticket) return notFound(number);
      if (ticket.assignee_id === profile.id) return toolResult({ claimed: formatTicketNumber(number), already_yours: true });
      if (ticket.assignee_id !== null) return toolError(`${formatTicketNumber(number)} is already assigned to someone else.`);
      // The conditional claim (UPDATE ... WHERE assignee_id IS NULL): a
      // concurrent claim wins and this one is told, never overwritten.
      const claimed = await claimTicket(profile.id, ticket.id);
      if (!claimed) return toolError(`Someone else claimed ${formatTicketNumber(number)} first.`);
      return toolResult({ claimed: formatTicketNumber(number), status: claimed.status });
    })
  );

  server.registerTool(
    "post_reply",
    {
      title: "Reply on a ticket",
      description:
        "Adds a comment to a ticket as you, like \"Add comment\" on the ticket page. A public reply is sent to " +
        "the customer; set internal to true for a note only staff can see. Use this only when you mean to send it.",
      inputSchema: {
        number: ticketNumber,
        message: z.string().describe(`The reply or note (at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters).`),
        internal: z.boolean().optional().describe("true: an internal note, never shown to the customer. Default false."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    guarded(async ({ number, message, internal = false }) => {
      const body = message.trim();
      if (!body) return toolError("The message can't be empty.");
      if (body.length > COMMENT_MAX_LENGTH) {
        return toolError(`The message must be at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters.`);
      }
      const ticket = await getTicketForStaffByNumber(number);
      if (!ticket) return notFound(number);
      // RLS refuses comments on closed tickets too; this says why.
      if (ticket.status === "closed") return toolError(`${formatTicketNumber(number)} is closed, so it can't take comments.`);
      try {
        await addComment(ticket.id, profile.id, body, internal);
      } catch (err) {
        if (err instanceof RateLimitError) return toolError(RATE_LIMITED_MESSAGE);
        throw err;
      }
      return toolResult({ posted_to: formatTicketNumber(number), internal, url: `${SITE_URL}/tickets/${ticket.id}` });
    })
  );

  server.registerTool(
    "set_status",
    {
      title: "Move a ticket to another status",
      description:
        "Moves a ticket the way the board does, allowed moves only: new or triaged to assigned or in_progress; " +
        "assigned to in_progress or back to triaged; in_progress to resolved or back to assigned; resolved to " +
        "closed or back to in_progress. Moving an unassigned ticket to assigned or in_progress claims it for you.",
      inputSchema: {
        number: ticketNumber,
        status: z.enum(TICKET_STATUSES).describe("The status to move it to."),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ number, status }) => {
      const ticket = await getTicketForStaffByNumber(number);
      if (!ticket) return notFound(number);
      if (ticket.status === status) return toolResult({ ticket: formatTicketNumber(number), status, unchanged: true });
      // The board's rules: the transition map, the claim on moving an
      // unassigned ticket, and a conditional update against the status read.
      const moved = await moveTicketAs(profile.id, ticket.id, status, ticket);
      if (!moved.ok) return toolError(moved.error);
      return toolResult({ ticket: formatTicketNumber(number), status });
    })
  );

  server.registerTool(
    "review_triage",
    {
      title: "Confirm or correct the AI's triage",
      description:
        "Records your review of the AI's priority, category and team, as the triage panel does. Leave a field out " +
        "to keep its current value; with none given, this confirms the AI's assessment as it is.",
      inputSchema: {
        number: ticketNumber,
        priority: z.enum(TRIAGE_PRIORITIES).optional(),
        category: z.enum(TRIAGE_CATEGORIES).optional(),
        team: z.enum(TRIAGE_TEAMS).optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    },
    guarded(async ({ number, priority, category, team }) => {
      const ticket = await getTicketForStaffByNumber(number);
      if (!ticket) return notFound(number);
      const fields = reviewFields(ticket, { priority, category, team });
      if (!fields) {
        return toolError("The AI hasn't set every field yet: give a priority, category and team to review it by hand.");
      }
      const latest = await getLatestTriageResult(ticket.id);
      try {
        // Against the run and the review this tool just read, so a newer
        // AI run or someone else's review in between is refused, not overwritten.
        const outcome = await reviewTriage(ticket.id, latest?.id ?? null, ticket.triage_state?.reviewed_at ?? null, fields);
        return toolResult({ ticket: formatTicketNumber(number), outcome, ...fields });
      } catch (err) {
        if (!(err instanceof TriageReviewError)) throw err;
        const why = {
          stale: "The AI's assessment changed just now. Read the ticket again and review the new one.",
          stale_review: "Someone else reviewed this ticket just now. Read the ticket again to see their review.",
          not_found: `Ticket ${formatTicketNumber(number)} isn't available to you any more.`,
          not_allowed: "You don't have permission to review triage.",
        }[err.reason];
        return toolError(why);
      }
    })
  );
}

// The fields to save: those given, else the current working values. Null
// when a field has neither (the AI hasn't finished, or failed).
function reviewFields(
  ticket: Ticket,
  given: { priority?: string; category?: string; team?: string }
): { priority: (typeof TRIAGE_PRIORITIES)[number]; category: (typeof TRIAGE_CATEGORIES)[number]; team: (typeof TRIAGE_TEAMS)[number] } | null {
  const priority = given.priority ?? ticket.triage_state?.priority ?? "";
  const category = given.category ?? ticket.triage_state?.category ?? "";
  const team = given.team ?? ticket.triage_state?.team ?? "";
  if (!isOneOf(TRIAGE_PRIORITIES, priority) || !isOneOf(TRIAGE_CATEGORIES, category) || !isOneOf(TRIAGE_TEAMS, team)) {
    return null;
  }
  return { priority, category, team };
}
