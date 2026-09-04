import { test, expect } from "@playwright/test";

import { login, requireEnv } from "./helpers";

// Hard-tier optional task: shareable AI outputs. Hits the real OpenRouter
// API for the triage step (same cost profile as tests/ai-triage.spec.ts).
test("staff can publish a public status page; an anonymous visitor sees only the snapshot, nothing else", async ({
  page,
  browser,
}) => {
  test.setTimeout(120_000);

  // `page` is customer A (default storageState). File a ticket and wait for
  // triage, same pattern as tests/ai-triage.spec.ts.
  const subject = `Shareable summary probe ${Date.now()}`;
  await page.goto("/tickets/new");
  await page.getByPlaceholder("Subject").fill(subject);
  await page
    .getByPlaceholder("Describe what's going on...")
    .fill("My export button has been spinning for twenty minutes and never finishes.");
  await page.getByRole("button", { name: "Submit ticket" }).click();
  await expect(page.getByRole("heading", { name: subject })).toBeVisible();
  const ticketUrl = page.url();

  const agentContext = await browser.newContext();
  const agentPage = await agentContext.newPage();
  await login(agentPage, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await agentPage.goto(ticketUrl);

  await expect(agentPage.getByRole("button", { name: "Publish public status page" })).toBeDisabled();

  // Poll until triage completes and the publish button becomes available.
  await expect(async () => {
    await agentPage.reload();
    await expect(
      agentPage.getByRole("button", { name: "Publish public status page" })
    ).toBeEnabled({ timeout: 1_500 });
  }).toPass({ timeout: 90_000, intervals: [2_000, 3_000, 5_000] });

  await agentPage.getByRole("button", { name: "Publish public status page" }).click();
  const shareLink = agentPage.locator("code");
  await expect(shareLink).toBeVisible();
  const shareUrl = (await shareLink.textContent())?.trim();
  expect(shareUrl).toMatch(/\/s\/[0-9a-f]{32}$/);

  // A brand-new, fully unauthenticated context -- no cookies, no session.
  const publicContext = await browser.newContext();
  const publicPage = await publicContext.newPage();
  const response = await publicPage.goto(shareUrl!);
  expect(response?.status()).toBe(200);
  await expect(publicPage.getByRole("heading", { name: subject })).toBeVisible();
  await expect(publicPage.getByText("Support ticket status")).toBeVisible();
  await expect(publicPage.getByText("new", { exact: true })).toBeVisible();
  // The AI summary is shown (some non-empty paraphrase), but the raw ticket
  // body and everything else about the ticket is never rendered here.
  await expect(publicPage.getByText("does not update automatically")).toBeVisible();
  await expect(publicPage.getByText("Comments", { exact: true })).not.toBeVisible();
  await expect(publicPage.getByText("spinning for twenty minutes")).not.toBeVisible();
  await expect(publicPage.getByRole("button", { name: "Sign in" })).not.toBeVisible();

  // Unpublish, then the same link must stop working.
  await agentPage.getByRole("button", { name: "Unpublish" }).click();
  await expect(agentPage.getByRole("button", { name: "Publish public status page" })).toBeVisible();

  const afterRevoke = await publicPage.goto(shareUrl!);
  expect(afterRevoke?.status()).toBe(404);
  await expect(publicPage.getByRole("heading", { name: subject })).not.toBeVisible();

  await publicContext.close();
  await agentContext.close();
});
