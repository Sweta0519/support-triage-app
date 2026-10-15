import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { parseAccessRequest } from "../app/lib/access-request-options";
import { login, requireEnv } from "./helpers";

// SUP-58: "Request access" files one access-request ticket the first time the
// new customer is signed in. Accounts are made with the Admin API, carrying
// the answers the sign-up form stores, rather than through the form itself:
// a real sign-up sends a confirmation email, and the project's mailer only
// allows a few an hour.

test.use({ storageState: { cookies: [], origins: [] } });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

const ANSWERS = { team: "Acme Robotics", size: "6-20", purpose: "Triage our support inbox." };

async function newAccount(metadata: Record<string, unknown> | undefined) {
  const admin = service();
  const email = `e2e-access-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const password = `Pw-${randomUUID()}`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true, user_metadata: metadata });
  expect(error).toBeNull();
  const id = data.user!.id;
  return {
    id,
    email,
    password,
    tickets: async () =>
      (await admin.from("tickets").select("id, subject, body, customer_id").eq("customer_id", id)).data ?? [],
    remove: async () => {
      // A filed request starts triage in the background: let it finish
      // before the ticket goes, so it never writes to a deleted ticket.
      const { data: open } = await admin.from("tickets").select("id").eq("customer_id", id);
      for (const t of open ?? []) {
        // Wait while it runs; one that stays pending a few seconds never started
        // (a request filed by calling the function directly).
        for (let i = 0; i < 60 && process.env.OPENROUTER_API_KEY; i++) {
          const { data: state } = await admin.from("ticket_triage_state").select("triage_status").eq("ticket_id", t.id).maybeSingle();
          const status = state?.triage_status ?? "pending";
          if (status === "completed" || status === "failed" || (status === "pending" && i >= 3)) break;
          await new Promise((r) => setTimeout(r, 1_000));
        }
      }
      await admin.from("tickets").delete().eq("customer_id", id);
      await admin.auth.admin.deleteUser(id);
    },
  };
}

test("the form's answers are parsed as the sign-up stores them: optional, trimmed, capped", () => {
  const form = (fields: Record<string, string>) => {
    const data = new FormData();
    for (const [k, v] of Object.entries(fields)) data.set(k, v);
    return data;
  };
  expect(parseAccessRequest(form({ team: "Acme" }))).toBeNull(); // no access=1: a plain sign-up
  expect(parseAccessRequest(form({ access: "1", team: "  Acme  ", size: "6-20", purpose: " Inbox " }))).toEqual({
    team: "Acme",
    size: "6-20",
    purpose: "Inbox",
  });
  const odd = parseAccessRequest(form({ access: "1", team: "x".repeat(150), size: "a million", purpose: "y".repeat(3000) }))!;
  expect(odd).toEqual({ team: "x".repeat(100), size: "", purpose: "y".repeat(2000) });
});

test("the Request access form asks the optional questions; a plain sign-up doesn't", async ({ page }) => {
  await page.goto("/signup?access=1");
  await expect(page.getByRole("heading", { name: "Request access" })).toBeVisible();
  await expect(page.getByLabel("Team or company name")).toBeVisible();
  await expect(page.getByLabel("Team size")).toBeVisible();
  await expect(page.getByLabel("What would you use it for?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Request access" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  await expect(page.getByLabel("Team or company name")).toHaveCount(0);

  // Every homepage "Request access" button leads to the form with the questions.
  await page.goto("/welcome");
  for (const href of await page.getByRole("link", { name: "Request access", exact: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    expect(href).toBe("/signup?access=1");
  }
});

test("the first sign-in files exactly one access-request ticket, as the customer, and says thanks", async ({ page }) => {
  const user = await newAccount({ access_request: ANSWERS });
  try {
    await login(page, user.email, user.password);
    await expect(page).toHaveURL(/\/tickets\?requested=1$/);
    await expect(page.getByRole("status")).toContainText("Thanks, we've got your request.");
    await expect(page.getByRole("link", { name: /Access request: Acme Robotics/ })).toBeVisible();

    const tickets = await user.tickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ subject: "Access request: Acme Robotics", customer_id: user.id });
    expect(tickets[0].body).toContain("Team size: 6-20");
    expect(tickets[0].body).toContain("What we'd use it for: Triage our support inbox.");

    // Signing in again files nothing more, and the role is still customer.
    await page.getByRole("button", { name: "Sign out" }).click();
    await login(page, user.email, user.password);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await user.tickets()).toHaveLength(1);
    const { data: profile } = await service().from("profiles").select("role, access_requested_at").eq("id", user.id).single();
    expect(profile!.role).toBe("customer");
    expect(profile!.access_requested_at).not.toBeNull();
    // Filed, so the copy kept with the sign-in is gone.
    const { data: account } = await service().auth.admin.getUserById(user.id);
    expect(account.user!.user_metadata.access_request).toBeUndefined();
  } finally {
    await user.remove();
  }
});

test("the email confirmation link files it too", async ({ page }) => {
  const user = await newAccount({ access_request: { team: "", size: "", purpose: "" } });
  try {
    // A one-time sign-in link, opened through the app's confirmation route,
    // as the confirmation email's link is.
    const { data, error } = await service().auth.admin.generateLink({ type: "magiclink", email: user.email });
    expect(error).toBeNull();
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=magiclink`);
    await expect(page).toHaveURL(/\/tickets\?requested=1$/);
    const tickets = await user.tickets();
    expect(tickets.map((t) => t.subject)).toEqual(["Access request"]);
    expect(tickets[0].body).toContain("Team: (not given)");
  } finally {
    await user.remove();
  }
});

test("a password-reset link goes to its own page, even with a request waiting; the request is filed quietly", async ({ page }) => {
  const user = await newAccount({ access_request: ANSWERS });
  try {
    const { data } = await service().auth.admin.generateLink({ type: "recovery", email: user.email });
    await page.goto(`/auth/confirm?token_hash=${data.properties!.hashed_token}&type=recovery&next=/account`);
    // Not taken over by the request: the reset goes on to its own page...
    await expect(page).toHaveURL(/\/account$/);
    // ...and the waiting request is filed by that page load, once.
    await expect.poll(async () => (await user.tickets()).length).toBe(1);
    await page.reload();
    expect(await user.tickets()).toHaveLength(1);
  } finally {
    await user.remove();
  }
});

test("a plain sign-up files nothing; and two calls at once still file one", async () => {
  const plain = await newAccount(undefined);
  const requester = await newAccount({ access_request: ANSWERS });
  try {
    const signedIn = async (email: string, password: string) => {
      const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
        db: { schema: "ticketing" },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await db.auth.signInWithPassword({ email, password })).error).toBeNull();
      return db;
    };

    const plainDb = await signedIn(plain.email, plain.password);
    expect((await plainDb.rpc("file_access_request")).data).toEqual([]);
    expect(await plain.tickets()).toHaveLength(0);

    const db = await signedIn(requester.email, requester.password);
    const results = await Promise.all([db.rpc("file_access_request"), db.rpc("file_access_request")]);
    expect(results.map((r) => r.error)).toEqual([null, null]);
    expect(results.flatMap((r) => r.data)).toHaveLength(1);
    expect(await requester.tickets()).toHaveLength(1);

    // Users can't clear the marker to file again.
    expect((await db.from("profiles").update({ access_requested_at: null }).eq("id", requester.id)).error).not.toBeNull();
    expect((await db.rpc("file_access_request")).data).toEqual([]);
    expect(await requester.tickets()).toHaveLength(1);
  } finally {
    await Promise.all([plain.remove(), requester.remove()]);
  }
});
