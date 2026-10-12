import { test, expect } from "@playwright/test";

import { isExplicitNotesQuestion } from "../app/lib/ai/notes-question";

// SUP-28: which messages force Sage to search the staff member's notes
// first. A pure function, so no browser or model is involved.

test("explicit questions about one's own notes force a search", () => {
  for (const message of [
    "Remind me, according to my notes: where is the Q3 launch?",
    "What do my notes say about the Antarctic penguin census schedule?",
    "Search my notes: what's the loading-dock code?",
    "anything in our saved notes about refunds?",
    "Check the team's notes for the escalation contacts",
    "Any notes about SLAs?",
    "What do the notes say about the venue?",
    "Check the team’s notes for the refund policy",
    "Check my team's notes for the refund policy",
    "What did I write about the Barbican?",
  ]) {
    expect(isExplicitNotesQuestion(message), message).toBe(true);
  }
});

test("other mentions of notes are left to the model", () => {
  for (const message of [
    "Draft a reply summarising the notes on this ticket",
    "What are the notes field limits in Zendesk?",
    "Paste the release notes for v2.1 into a customer reply",
    "Who gave the keynotes last year?",
    "What is Paris the capital of? One word.",
    "Can you rewrite this paragraph more politely?",
    "Ignore my notes and just draft a reply",
    "Rewrite the note to the customer more politely",
  ]) {
    expect(isExplicitNotesQuestion(message), message).toBe(false);
  }
});
