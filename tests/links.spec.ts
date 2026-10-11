import { test, expect } from "@playwright/test";

import { stripAllLinks, stripForeignLinks } from "../app/lib/ai/links";

// Link stripping on triage output and on what gets published to the public
// status page (security scan 2026-10-11, L-2).

test("stripAllLinks removes URLs and emails and keeps ordinary text", () => {
  expect(stripAllLinks("Verify at https://evil.example/login now.")).toBe("Verify at [link removed] now.");
  expect(stripAllLinks("Visit evil.example/reset, then reply.")).toBe("Visit [link removed], then reply.");
  expect(stripAllLinks("Email help@evil.example.")).toBe("Email [link removed].");
  for (const text of ["Upgrade to v2.1.3", "e.g. the login page", "Rated 3.5/5", "Attached report.pdf", "N/A", "10.0.0.1/24"]) {
    expect(stripAllLinks(text), text).toBe(text);
  }
});

test("stripForeignLinks keeps links the customer wrote and removes the rest", () => {
  const ticket = "My invoice at https://billing.example.com/inv/42 is wrong.";
  expect(stripForeignLinks("See https://billing.example.com/inv/42.", ticket)).toBe("See https://billing.example.com/inv/42.");
  expect(stripForeignLinks("Pay at https://evil.example/pay.", ticket)).toBe("Pay at [link removed].");
});
