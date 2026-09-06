import { test, expect, type Page } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { login, requireEnv } from "./helpers";

// Sage's "chat with your own notes" feature: a staff member's private notes
// are chunked + embedded on save, and Sage can call a search_notes tool to
// answer from them. Hits the real OpenRouter API (embeddings + chat), so
// these are slow and run serially -- they also share the one Sage
// conversation per staff member, like tests/ai-chat.spec.ts.

async function openSage(page: Page) {
  await page.getByRole("button", { name: "Open Sage" }).click();
  await expect(page.getByPlaceholder("Message Sage...")).toBeEnabled({ timeout: 15_000 });
}

async function askSage(page: Page, question: string) {
  await page.getByPlaceholder("Message Sage...").fill(question);
  await page.getByRole("button", { name: "Send" }).click();
  // A retrieval turn is up to three completions plus embedding calls.
  await expect(page.getByPlaceholder("Message Sage...")).toBeEnabled({ timeout: 120_000 });
  return page.getByTestId("assistant-widget-message").last();
}

async function saveNote(page: Page, title: string, body: string) {
  await page.goto("/notes/new");
  await page.getByPlaceholder("Title").fill(title);
  await page.getByPlaceholder("Write the note...").fill(body);
  await page.getByRole("button", { name: "Save note" }).click();
  // Redirects to the list on success, where the new note is visible.
  await expect(page).toHaveURL(/\/notes$/);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
}

test.describe("Sage: chat with your own notes", () => {
  test.describe.configure({ mode: "serial" });

  test.beforeEach(() => {
    requireEnv("OPENROUTER_API_KEY");
  });

  test("answers from a saved note and cites it", async ({ browser }) => {
    test.setTimeout(240_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    const title = "Q3 launch logistics";
    await saveNote(
      page,
      title,
      "The venue for the Q3 launch is the Barbican in London, and the budget is £8,000. " +
        "Catering is by Marigold Kitchen; the AV supplier is still to be confirmed."
    );

    await page.goto("/queue");
    await openSage(page);
    const reply = await askSage(page, "Where is the Q3 launch being held, and what's the budget?");

    // The facts only exist in the note, so they can only have come from a
    // search -- and the reply must say which note they came from.
    await expect(reply).toContainText(/Barbican/i);
    await expect(reply).toContainText(/8,?000/);
    await expect(reply).toContainText(title);
    // The retrieval indicator confirms a search actually ran (rather than,
    // say, the model happening to remember the note from an earlier turn).
    await expect(page.getByTestId("assistant-widget-search").last()).toContainText(/[1-9]\d* match/);

    await context.close();
  });

  test("says so when no note answers the question, instead of guessing", async ({ browser }) => {
    test.setTimeout(240_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    await page.goto("/queue");
    await openSage(page);
    const reply = await askSage(
      page,
      "What do my notes say about the Antarctic penguin census schedule?"
    );

    const text = (await reply.textContent()) ?? "";
    // It must admit the gap ("couldn't find anything in your notes about
    // ...") rather than answer from general knowledge or borrow the Q3
    // launch note's details.
    expect(text).toMatch(/\b(couldn't|could not|didn't|did not|don't|do not|no|nothing|not|unable)\b/i);
    expect(text).toMatch(/notes?/i);
    expect(text).not.toMatch(/Barbican|Marigold/i);

    await context.close();
  });

  test("answers general knowledge directly, without searching", async ({ browser }) => {
    test.setTimeout(240_000);

    const context = await browser.newContext();
    const page = await context.newPage();
    await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));

    await page.goto("/queue");
    await openSage(page);
    const searchesBefore = await page.getByTestId("assistant-widget-search").count();

    const reply = await askSage(page, "What is Paris the capital of? One word.");
    await expect(reply).toContainText(/France/i);
    // The retrieve-or-not decision: a plain fact must not trigger a search,
    // so no new retrieval indicator appears under this reply.
    expect(await page.getByTestId("assistant-widget-search").count()).toBe(searchesBefore);

    await context.close();
  });

  test("one staff member's notes never surface in another's chat or searches", async ({
    browser,
  }) => {
    test.setTimeout(300_000);

    const agentEmail = requireEnv("TEST_AGENT_EMAIL");
    const agentPassword = requireEnv("TEST_AGENT_PASSWORD");
    const adminEmail = requireEnv("TEST_ADMIN_EMAIL");
    const adminPassword = requireEnv("TEST_ADMIN_PASSWORD");

    // User A (the agent) writes down something distinctive.
    const marker = `SECRET_MARKER-${Date.now()}`;
    const secretTitle = "Vendor access codes";
    const contextA = await browser.newContext();
    const pageA = await contextA.newPage();
    await login(pageA, agentEmail, agentPassword);
    await saveNote(
      pageA,
      secretTitle,
      `${marker}: the loading-dock gate code for the Barbican vendor entrance is 4471.`
    );
    await contextA.close();

    // User B (the admin -- also staff, so Sage and notes are available to
    // them) asks the questions most likely to surface it.
    const contextB = await browser.newContext();
    const pageB = await contextB.newPage();
    await login(pageB, adminEmail, adminPassword);

    await pageB.goto("/notes");
    await expect(pageB.getByText(secretTitle)).not.toBeVisible();

    await pageB.goto("/queue");
    await openSage(pageB);
    const reply = await askSage(
      pageB,
      "Search my notes: what is the SECRET_MARKER, and what is the loading-dock gate code " +
        "for the Barbican vendor entrance?"
    );
    const text = (await reply.textContent()) ?? "";
    expect(text).not.toContain(marker);
    expect(text).not.toMatch(/4471/);
    await contextB.close();

    // The lab's "can a user call the retrieval endpoint manually with a
    // different user's id?" check. match_documents() takes no user id at
    // all -- it scopes to auth.uid() and runs under the documents RLS
    // policy -- so the strongest thing B can do is call it directly with
    // their own session, a permissive threshold, and the biggest allowed
    // result count. Same call as A proves the function itself works.
    const url = requireEnv("NEXT_PUBLIC_SUPABASE_URL");
    const anonKey = requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY");
    // A unit vector with no particular direction: every chunk has some
    // finite similarity to it, and threshold -1 lets all of them through.
    const probe = new Array(1536).fill(1 / Math.sqrt(1536));

    async function matchesAs(email: string, password: string) {
      const db = createClient(url, anonKey, {
        db: { schema: "ticketing" },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error: signInError } = await db.auth.signInWithPassword({ email, password });
      expect(signInError).toBeNull();
      const { data, error } = await db.rpc("match_documents", {
        query_embedding: probe,
        match_threshold: -1,
        match_count: 10,
      });
      expect(error).toBeNull();
      const { data: docs, error: docsError } = await db.from("documents").select("note_id, content");
      expect(docsError).toBeNull();
      await db.auth.signOut();
      return {
        matched: (data ?? []) as { note_title: string; content: string }[],
        visible: (docs ?? []) as { content: string }[],
      };
    }

    const asB = await matchesAs(adminEmail, adminPassword);
    expect(asB.matched.some((m) => m.content.includes(marker))).toBe(false);
    expect(asB.matched.some((m) => m.note_title === secretTitle)).toBe(false);
    expect(asB.visible.some((d) => d.content.includes(marker))).toBe(false);

    const asA = await matchesAs(agentEmail, agentPassword);
    expect(asA.matched.some((m) => m.content.includes(marker))).toBe(true);
  });
});
