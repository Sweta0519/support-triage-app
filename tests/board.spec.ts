import { test, expect } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { boardTargets, canMove, moveClaimsTicket } from "../app/lib/board";
import { login, requireEnv } from "./helpers";

// SUP-9: the staff triage board. Move rules are pure and tested directly;
// the browser tests seed tickets with the service role and delete them
// afterwards.

test.use({ storageState: { cookies: [], origins: [] } });

test.describe("board move rules", () => {
  test("only the transitions the database allows", () => {
    expect(boardTargets("new")).toEqual(["assigned", "in_progress"]);
    expect(canMove("new", "resolved")).toBe(false);
    expect(canMove("in_progress", "resolved")).toBe(true);
    expect(canMove("resolved", "closed")).toBe(true);
    expect(canMove("assigned", "assigned")).toBe(false);
    expect(boardTargets("closed")).toEqual([]);
  });

  test("moving an unassigned ticket into Assigned or In progress claims it", () => {
    expect(moveClaimsTicket(null, "in_progress")).toBe(true);
    expect(moveClaimsTicket(null, "assigned")).toBe(true);
    expect(moveClaimsTicket(null, "resolved")).toBe(false);
    expect(moveClaimsTicket("someone", "in_progress")).toBe(false);
  });
});

const db = () =>
  createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
const seeded: string[] = [];
test.afterEach(async () => {
  if (seeded.length) await db().from("tickets").delete().in("id", seeded.splice(0));
});
async function seed(subject: string) {
  const { data: customer } = await db().from("profiles").select("id").eq("email", requireEnv("TEST_USER_EMAIL")).single();
  const { data, error } = await db()
    .from("tickets")
    .insert({ customer_id: customer!.id, subject, body: "Board probe." })
    .select("id, number")
    .single();
  if (error) throw new Error(error.message);
  seeded.push(data.id);
  return data as { id: string; number: number };
}
const column = (page: import("@playwright/test").Page, name: string) =>
  page.getByRole("region", { name: new RegExp(`^${name}, \\d+ tickets$`) });

test("dragging a new ticket to In progress claims it; the Move menu offers only allowed moves", async ({ page }) => {
  const subject = `Board drag probe ${Date.now()}`;
  const ticket = await seed(subject);

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.getByRole("link", { name: "Board", exact: true }).click();
  const card = page.locator("article", { hasText: subject });
  await expect(column(page, "New").locator("article", { hasText: subject })).toBeVisible();

  // Only New's allowed targets are offered.
  const menu = page.getByLabel(new RegExp(`^Move #${ticket.number} `));
  await expect(menu.locator("option")).toHaveText(["Move to…", "Assigned", "In progress"]);

  // Drag events dispatched on this card itself: a mouse drag can land on a
  // neighbouring card when the board scrolls, and the board shows real
  // tickets too.
  const target = column(page, "In progress");
  const dataTransfer = await page.evaluateHandle(() => new DataTransfer());
  await card.dispatchEvent("dragstart", { dataTransfer });
  await target.dispatchEvent("dragover", { dataTransfer });
  await target.dispatchEvent("drop", { dataTransfer });
  await card.dispatchEvent("dragend", { dataTransfer });
  await expect(page.getByRole("status").filter({ hasText: `Moved #${ticket.number} to In progress.` })).toBeVisible();
  await expect(column(page, "In progress").locator("article", { hasText: subject })).toContainText("Yours");
  const { data: stored } = await db().from("tickets").select("status, assignee_id").eq("id", ticket.id).single();
  expect(stored?.status).toBe("in_progress");
  expect(stored?.assignee_id).not.toBeNull();

  // Keyboard path: the Move menu.
  await page.getByLabel(new RegExp(`^Move #${ticket.number} `)).selectOption("resolved");
  await expect(column(page, "Resolved").locator("article", { hasText: subject })).toBeVisible();
  // The card moves optimistically; wait for the server to confirm.
  await expect(page.getByRole("status").filter({ hasText: `Moved #${ticket.number} to Resolved.` })).toBeVisible();
  expect((await db().from("tickets").select("status").eq("id", ticket.id).single()).data?.status).toBe("resolved");
});

test("a move that loses a claim race says so and puts the card back", async ({ page }) => {
  const subject = `Board race probe ${Date.now()}`;
  const ticket = await seed(subject);
  const { data: admin } = await db().from("profiles").select("id").eq("email", requireEnv("TEST_ADMIN_EMAIL")).single();

  await login(page, requireEnv("TEST_AGENT_EMAIL"), requireEnv("TEST_AGENT_PASSWORD"));
  await page.goto("/board");
  await expect(column(page, "New").locator("article", { hasText: subject })).toBeVisible();

  // The admin takes it after the board rendered.
  await db().from("tickets").update({ assignee_id: admin!.id, status: "assigned" }).eq("id", ticket.id);
  await page.getByLabel(new RegExp(`^Move #${ticket.number} `)).selectOption("in_progress");
  await expect(page.getByRole("status").filter({ hasText: "no longer available to you" })).toBeVisible();
  // The refreshed board no longer shows it to this agent (RLS).
  await expect(page.locator("article", { hasText: subject })).toHaveCount(0);
});
