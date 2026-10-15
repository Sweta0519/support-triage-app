import "server-only";

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { after } from "next/server";
import { z } from "zod";

import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { runTriage } from "@/app/lib/ai/triage";
import { statusLabel } from "@/app/lib/badges";
import { addComment, COMMENT_MAX_LENGTH, listComments } from "@/app/lib/db/comments";
import { getPersonCards } from "@/app/lib/db/people";
import type { Profile } from "@/app/lib/db/profiles";
import { RATE_LIMITED_MESSAGE, RateLimitError } from "@/app/lib/db/rate-limit";
import {
  BODY_MAX_LENGTH,
  createTicket,
  getMyTicketByNumber,
  listMyTickets,
  SUBJECT_MAX_LENGTH,
  ticketFieldsError,
  type TicketStatus,
} from "@/app/lib/db/tickets";
import { formatTicketNumber } from "@/app/lib/format";
import { commentAuthorLabel } from "@/app/lib/people";
import { SITE_URL, toolError, toolResult, untrusted } from "./results";

// The customer's tools (SUP-55): the same four things the web app lets a
// customer do with their tickets, through the same app/lib/db/ functions,
// validation and rate limits, running as them under RLS. Nothing here
// returns AI triage or internal notes: those aren't readable by customers
// at all (RLS), and these tools never ask for them.

const OPEN_STATUSES: TicketStatus[] = ["new", "triaged", "assigned", "in_progress"];
const STATUS_FILTERS = ["open", "new", "triaged", "assigned", "in_progress", "resolved", "closed"] as const;
const LIST_LIMIT = 50;

const ticketNumber = z
  .number()
  .int()
  .positive()
  .describe("The ticket's number, without the #: 1042 for ticket #1042.");

const notFound = (number: number) =>
  toolError(`You don't have a ticket ${formatTicketNumber(number)}. Use list_my_tickets to see your tickets.`);

export function registerCustomerTools(server: McpServer, profile: Profile) {
  server.registerTool(
    "create_ticket",
    {
      title: "File a support ticket",
      description:
        "Files a new support ticket as the signed-in customer, exactly as the web form does. " +
        "Support's AI triage reads it straight away and the support team picks it up from there. " +
        "Returns the new ticket's number and link.",
      inputSchema: {
        subject: z.string().describe(`A short summary of the problem (at most ${SUBJECT_MAX_LENGTH} characters).`),
        description: z
          .string()
          .describe(`What happened, what was expected, and any details support needs (at most ${BODY_MAX_LENGTH.toLocaleString()} characters).`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ subject, description }) => {
      const s = subject.trim();
      const body = description.trim();
      const invalid = ticketFieldsError(s, body);
      if (invalid) return toolError(invalid);
      let ticket: { id: string; number: number };
      try {
        ticket = await createTicket(profile.id, s, body);
      } catch (err) {
        if (err instanceof RateLimitError) return toolError(RATE_LIMITED_MESSAGE);
        throw err;
      }
      // As the web form: triage runs after the response, with the service
      // role (app/lib/ai/), so it doesn't depend on this request's session.
      if (isAiConfigured()) after(() => runTriage(ticket.id));
      return toolResult({
        number: formatTicketNumber(ticket.number),
        status: statusLabel("new"),
        url: `${SITE_URL}/tickets/${ticket.id}`,
      });
    }
  );

  server.registerTool(
    "list_my_tickets",
    {
      title: "List my tickets",
      description: `The signed-in customer's tickets, newest first (at most ${LIST_LIMIT}): number, subject, status and when each last changed.`,
      inputSchema: {
        status: z
          .enum(STATUS_FILTERS)
          .optional()
          .describe('Only tickets with this status. "open" means not yet resolved or closed.'),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ status }) => {
      const all = await listMyTickets(profile.id);
      const matching = all.filter((t) =>
        !status ? true : status === "open" ? OPEN_STATUSES.includes(t.status) : t.status === status
      );
      return toolResult({
        tickets: matching.slice(0, LIST_LIMIT).map((t) => ({
          number: formatTicketNumber(t.number),
          subject: untrusted(t.subject),
          status: statusLabel(t.status),
          created_at: t.created_at,
          updated_at: t.updated_at,
        })),
        ...(matching.length > LIST_LIMIT ? { more: matching.length - LIST_LIMIT } : {}),
      });
    }
  );

  server.registerTool(
    "get_ticket",
    {
      title: "Read one of my tickets",
      description:
        "One of the signed-in customer's tickets: its status, description and the conversation with support, " +
        "as the customer sees it on the web.",
      inputSchema: { number: ticketNumber },
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async ({ number }) => {
      const ticket = await getMyTicketByNumber(profile.id, number);
      if (!ticket) return notFound(number);
      // Customers' reads: public replies only (RLS hides internal notes too).
      const comments = await listComments(ticket.id, false);
      const people = await getPersonCards([ticket.customer_id, ...comments.map((c) => c.author_id)]);
      return toolResult({
        number: formatTicketNumber(ticket.number),
        subject: untrusted(ticket.subject),
        status: statusLabel(ticket.status),
        created_at: ticket.created_at,
        updated_at: ticket.updated_at,
        ...(ticket.created_by ? { filed_by_support: true } : {}),
        description: untrusted(ticket.body),
        replies: comments.map((c) => ({
          from: commentAuthorLabel(c.author_id, profile.id, ticket.customer_id, false, people),
          at: c.created_at,
          message: untrusted(c.body),
        })),
        url: `${SITE_URL}/tickets/${ticket.id}`,
      });
    }
  );

  server.registerTool(
    "add_reply",
    {
      title: "Reply on my ticket",
      description:
        "Adds a reply from the signed-in customer to one of their tickets, visible to the support team, " +
        "as on the web. Closed tickets can't be replied to: file a new ticket instead.",
      inputSchema: {
        number: ticketNumber,
        message: z.string().describe(`The reply (at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters).`),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
    },
    async ({ number, message }) => {
      const body = message.trim();
      if (!body) return toolError("The reply can't be empty.");
      if (body.length > COMMENT_MAX_LENGTH) {
        return toolError(`The reply must be at most ${COMMENT_MAX_LENGTH.toLocaleString()} characters.`);
      }
      const ticket = await getMyTicketByNumber(profile.id, number);
      if (!ticket) return notFound(number);
      if (ticket.status === "closed") {
        return toolError(`${formatTicketNumber(number)} is closed, so it can't take replies. File a new ticket instead.`);
      }
      try {
        await addComment(ticket.id, profile.id, body, false);
      } catch (err) {
        if (err instanceof RateLimitError) return toolError(RATE_LIMITED_MESSAGE);
        throw err;
      }
      return toolResult({ replied_to: formatTicketNumber(number), url: `${SITE_URL}/tickets/${ticket.id}` });
    }
  );
}
