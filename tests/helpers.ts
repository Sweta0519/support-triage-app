import { expect, type Page } from "@playwright/test";

export async function login(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByPlaceholder("Email").fill(email);
  await page.getByPlaceholder("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  // "Sign out" only renders once signed in -- unambiguous post-login marker.
  await expect(page.getByRole("button", { name: "Sign out" })).toBeVisible();
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Set ${name} in .env.local.`);
  }
  return value;
}

// Sage is a floating widget on every staff page, opened via the launcher.
export async function openSage(page: Page) {
  await page.getByRole("button", { name: "Open Sage" }).click();
  await expect(page.getByPlaceholder("Message Sage...")).toBeEnabled({ timeout: 15_000 });
}

// Sends one message and returns Sage's reply bubble. Waits for the question
// and the reply to both land -- or fails with the widget's own error text
// (a rate limit, a model error) -- so a failed send is never read as the
// previous turn's reply via .last().
export async function askSage(page: Page, question: string) {
  const messages = page.getByTestId("assistant-widget-message");
  const sendError = page.getByTestId("assistant-widget-error");
  const before = await messages.count();
  await page.getByPlaceholder("Message Sage...").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  // A retrieval turn is up to three completions plus embedding calls.
  await expect(messages.nth(before + 1).or(sendError)).toBeVisible({ timeout: 120_000 });
  if (await sendError.isVisible()) {
    throw new Error(`Sage didn't reply: ${await sendError.textContent()}`);
  }
  await expect(messages).toHaveCount(before + 2);
  return messages.last();
}

// Picks a staff member in the admin's Reassign dropdown by email. The
// option reads "Name · email (role)" once they've set a display name, so
// match on the email rather than the whole label.
export async function selectStaffByEmail(page: Page, email: string) {
  const select = page.getByLabel("Reassign");
  const value = await select.locator("option", { hasText: email }).getAttribute("value");
  if (!value) throw new Error(`No Reassign option for ${email}`);
  await select.selectOption(value);
}
