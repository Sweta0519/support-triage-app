import { test, expect } from "@playwright/test";

import {
  buildAssessmentPrompt,
  buildAssessmentSchema,
  buildReplyPrompt,
  normalizeReply,
  REPLY_SCHEMA,
} from "../app/lib/ai/triage-prompts";

// SUP-31: other customers' ticket text goes to the call that links
// duplicates, never to the call that drafts the customer-facing reply.
// Pure functions: no browser, no model.

const ticket = {
  subject: "Charged twice for September",
  body: "My card was charged twice for the September invoice. Order 4471.",
};
const otherCustomer = {
  ticket_id: "11111111-1111-1111-1111-111111111111",
  status: "new",
  subject: "Refund for Acme Corp duplicate charge",
  latest_summary: "Acme's finance lead Jane Roe wants a refund of $1,200.",
  similarity: 0.91,
} as unknown as Parameters<typeof buildAssessmentPrompt>[1][number];

test("the reply prompt carries only this ticket", () => {
  const prompt = buildReplyPrompt(ticket);
  expect(prompt).toContain(ticket.subject);
  expect(prompt).toContain("Order 4471");
  // It takes no candidates at all -- and the schema has nowhere to put one.
  expect(buildReplyPrompt.length).toBe(1);
  expect(Object.keys(REPLY_SCHEMA.properties as object)).toEqual(["suggested_reply", "missing_info"]);
});

test("the assessment prompt sees candidates but has no reply to write", () => {
  const prompt = buildAssessmentPrompt(ticket, [otherCustomer]);
  expect(prompt).toContain(otherCustomer.ticket_id);
  expect(prompt).toContain("Acme Corp");
  const schema = buildAssessmentSchema([otherCustomer.ticket_id]);
  const fields = Object.keys(schema.properties as object);
  expect(fields).not.toContain("suggested_reply");
  expect(fields).not.toContain("missing_info");
  expect(fields).toEqual(expect.arrayContaining(["duplicate_of", "related_ticket_ids", "category", "priority"]));
});

test("the reply is still cleaned: no timeframe promises, no foreign links", () => {
  const reply = normalizeReply(
    {
      suggested_reply:
        "Sorry about the double charge. We'll fix this within 24 hours. See https://evil.example for details. We're looking into order 4471.",
      missing_info: ["Last four digits of the card"],
    },
    `${ticket.subject}\n${ticket.body}`
  );
  expect(reply.suggested_reply).not.toMatch(/within 24 hours/i);
  expect(reply.suggested_reply).not.toContain("evil.example");
  expect(reply.suggested_reply).toContain("order 4471");
  expect(reply.missing_info).toEqual(["Last four digits of the card"]);
});
