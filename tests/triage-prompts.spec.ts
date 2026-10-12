import { test, expect } from "@playwright/test";

import {
  buildAssessmentSchema,
  buildTriageRequests,
  normalizeAssessment,
  normalizeReply,
  type TriageAssessment,
} from "../app/lib/ai/triage-prompts";

// SUP-31: other customers' ticket text goes to the call that links
// duplicates, never to the call that writes customer-visible text (the
// summary, which can be published on a share page, and the draft reply).
// Pure functions: no browser, no model.

const ticket = {
  subject: "Charged twice for September",
  body: "My card was charged twice for the September invoice. Order 4471.",
};
const CANDIDATE_ID = "11111111-1111-1111-1111-111111111111";
const otherCustomer = {
  ticket_id: CANDIDATE_ID,
  status: "new",
  subject: "Refund for Acme Corp duplicate charge",
  latest_summary: "Acme's finance lead Jane Roe wants a refund of $1,200.",
  similarity: 0.91,
} as unknown as Parameters<typeof buildTriageRequests>[1][number];

test("the call that writes customer-visible text never sees another customer", () => {
  const { assessment, reply } = buildTriageRequests(ticket, [otherCustomer]);

  // The reply request -- prompt, system prompt and schema -- carries none of
  // the other customer's text or id, but does carry this ticket.
  const replyRequest = JSON.stringify(reply);
  for (const leaked of ["Acme", "Jane Roe", "1,200", CANDIDATE_ID]) {
    expect(replyRequest, leaked).not.toContain(leaked);
  }
  expect(reply.user).toContain("Order 4471");
  // It produces the summary and the reply; nothing about links.
  expect(Object.keys(reply.schema.properties as object).sort()).toEqual(["missing_info", "suggested_reply", "summary"]);

  // The assessment does see the candidate (to link it), but has no
  // customer-visible text to write.
  expect(assessment.user).toContain("Acme Corp");
  expect(assessment.user).toContain(CANDIDATE_ID);
  const assessmentFields = Object.keys(assessment.schema.properties as object);
  for (const field of ["summary", "suggested_reply", "missing_info"]) {
    expect(assessmentFields).not.toContain(field);
  }
  expect(assessmentFields).toEqual(expect.arrayContaining(["duplicate_of", "related_ticket_ids", "category", "priority"]));
});

test("with no candidates, the assessment can't reference any ticket", () => {
  const schema = buildAssessmentSchema([]) as { properties: Record<string, { items?: { enum: string[] } }> };
  expect(schema.properties.related_ticket_ids.items?.enum).toEqual(["__none__"]);
});

test("the assessment is validated: ids from the candidate list only, enums, confidence", () => {
  const { output, needsHumanReview } = normalizeAssessment(
    {
      category: "not-a-category",
      priority: "high",
      priority_reason: "Double charge; see https://evil.example",
      team: "billing",
      frustration: 9,
      is_escalation_risk: true,
      duplicate_of: "99999999-9999-9999-9999-999999999999",
      related_ticket_ids: [CANDIDATE_ID, "made-up-id"],
      confidence: 0.9,
    } as unknown as TriageAssessment,
    new Set([CANDIDATE_ID])
  );
  expect(output.category).toBe("general");
  expect(needsHumanReview).toBe(true);
  expect(output.duplicate_of).toBeNull();
  expect(output.related_ticket_ids).toEqual([CANDIDATE_ID]);
  expect(output.frustration).toBe(3);
  expect(output.priority_reason).not.toContain("evil.example");

  const confident = normalizeAssessment(
    { ...output, category: "billing", confidence: 0.3 } as TriageAssessment,
    new Set([CANDIDATE_ID])
  );
  expect(confident.needsHumanReview).toBe(true);
});

test("the summary and reply are still cleaned: no timeframe promises, no foreign links", () => {
  const reply = normalizeReply(
    {
      summary: "Customer double-charged; details at https://evil.example",
      suggested_reply:
        "Sorry about the double charge. We'll fix this within 24 hours. See https://evil.example for details. We're looking into order 4471.",
      missing_info: ["Last four digits of the card"],
    },
    `${ticket.subject}\n${ticket.body}`
  );
  expect(reply.summary).not.toContain("evil.example");
  expect(reply.suggested_reply).not.toMatch(/within 24 hours/i);
  expect(reply.suggested_reply).not.toContain("evil.example");
  expect(reply.suggested_reply).toContain("order 4471");
  expect(reply.missing_info).toEqual(["Last four digits of the card"]);
});
