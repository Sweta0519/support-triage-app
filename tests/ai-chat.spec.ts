import { randomUUID } from "node:crypto";

import { test, expect } from "@playwright/test";

import { askSage, login, openSage, requireEnv } from "./helpers";

// Hits the real OpenRouter API. Staff-only feature, so both tests sign in
// as the agent test account rather than using the default customer
// storageState -- and, because there is one active conversation per staff
// member (not one per test run), both tests share the same underlying
// conversation row. Serial mode keeps them from racing each other's writes
// to it (the suite otherwise runs fullyParallel).
test.describe("Sage, the AI assistant widget", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(() => {
    requireEnv("OPENROUTER_API_KEY");
  });

  test("remembers earlier turns in the same conversation", async ({ browser }) => {
    test.setTimeout(120_000);

    const agentEmail = requireEnv("TEST_AGENT_EMAIL");
    const agentPassword = requireEnv("TEST_AGENT_PASSWORD");

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, agentEmail, agentPassword);

    await page.goto("/queue");
    await openSage(page);

    // Deliberately mundane: a phrase like "the launch code is ..." reliably
    // makes the model hedge and refuse to repeat it back, even though it
    // can see it in context -- a model-safety quirk, not a memory failure,
    // but it makes that phrasing useless for this assertion.
    const probe = `probe-${randomUUID().slice(0, 8)}`;
    await askSage(
      page,
      `Here's a fact about me: my favorite queue filter is "${probe}". ` +
        "Just acknowledge it, don't repeat it back yet."
    );
    const reply = await askSage(page, "What did I just tell you my favorite queue filter was?");

    // The reply must quote this run's filter name back -- only possible if
    // the prior turn was actually sent as context, not just the latest
    // message. askSage returns the new reply, never an earlier bubble.
    await expect(reply).toContainText(probe);

    await context.close();
  });

  test("persists the conversation across a page refresh", async ({ browser }) => {
    test.setTimeout(120_000);

    const agentEmail = requireEnv("TEST_AGENT_EMAIL");
    const agentPassword = requireEnv("TEST_AGENT_PASSWORD");

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, agentEmail, agentPassword);

    await page.goto("/queue");
    await openSage(page);

    // exact: true -- the model sometimes quotes the probe back in its reply,
    // and a bare text match would then resolve to two elements.
    // randomUUID, not Date.now(): repeats on different workers share the
    // agent's one conversation and can send in the same millisecond.
    const first = `Persistence probe one ${randomUUID()}`;
    await askSage(page, first);
    await expect(page.getByText(first, { exact: true })).toBeVisible();

    const second = `Persistence probe two ${randomUUID()}`;
    await askSage(page, second);
    await expect(page.getByText(second, { exact: true })).toBeVisible();

    await page.reload();
    await openSage(page);
    await expect(page.getByText(first, { exact: true })).toBeVisible();
    await expect(page.getByText(second, { exact: true })).toBeVisible();

    await context.close();
  });
});
