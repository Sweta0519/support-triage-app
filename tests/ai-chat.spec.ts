import { test, expect } from "@playwright/test";

import { login, requireEnv } from "./helpers";

// Hits the real OpenRouter API. Staff-only feature, so both tests sign in
// as the agent test account rather than using the default customer
// storageState -- and, because there is one active conversation per staff
// member (not one per test run), both tests share the same underlying
// conversation row. Serial mode keeps them from racing each other's writes
// to it (the suite otherwise runs fullyParallel).
test.describe("AI assistant chat", () => {
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

    await page.goto("/assistant");

    // Deliberately mundane: a phrase like "the launch code is ..." reliably
    // makes the model hedge and refuse to repeat it back, even though it
    // can see it in context -- a model-safety quirk, not a memory failure,
    // but it makes that phrasing useless for this assertion.
    const fact = `my favorite queue filter is "probe-${Date.now()}"`;
    await page.getByPlaceholder("Ask the assistant...").fill(
      `Here's a fact about me: ${fact}. Just acknowledge it, don't repeat it back yet.`
    );
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 });

    await page
      .getByPlaceholder("Ask the assistant...")
      .fill("What did I just tell you my favorite queue filter was?");
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 });

    // The reply should quote the filter name back -- only possible if the
    // prior turn was actually sent as context, not just the latest message.
    // It also appears in the earlier user message, so scope to the latest
    // bubble (the assistant's reply) to avoid an ambiguous match.
    await expect(page.locator("li").last()).toContainText(`probe-`);

    await context.close();
  });

  test("persists the conversation across a page refresh", async ({ browser }) => {
    test.setTimeout(120_000);

    const agentEmail = requireEnv("TEST_AGENT_EMAIL");
    const agentPassword = requireEnv("TEST_AGENT_PASSWORD");

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, agentEmail, agentPassword);

    await page.goto("/assistant");

    const first = `Persistence probe one ${Date.now()}`;
    await page.getByPlaceholder("Ask the assistant...").fill(first);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(first)).toBeVisible();

    const second = `Persistence probe two ${Date.now()}`;
    await page.getByPlaceholder("Ask the assistant...").fill(second);
    await page.getByRole("button", { name: "Send" }).click();
    await expect(page.getByRole("button", { name: "Send" })).toBeEnabled({ timeout: 60_000 });
    await expect(page.getByText(second)).toBeVisible();

    await page.reload();
    await expect(page.getByText(first)).toBeVisible();
    await expect(page.getByText(second)).toBeVisible();

    await context.close();
  });
});
