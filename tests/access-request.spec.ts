import { randomUUID } from "node:crypto";

import { expect, test } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

import { parseAccessRequest } from "../app/lib/access-request-options";
import { INCIDENT_MIN_TICKETS, INCIDENT_SIMILARITY, INCIDENT_WINDOW_MINUTES } from "../app/lib/incidents";
import { login, requireEnv } from "./helpers";

// SUP-58: "Get in touch" (formerly "Request access", SUP-72) files one access-request ticket the first time the
// new customer is signed in. One test signs up through the real form, which
// works because this project confirms emails automatically, so no email is
// sent (SUP-69). The rest make accounts with the Admin API, carrying the
// answers the form stores, so they can reach the confirmation-link and
// sign-in paths directly, and don't depend on that setting.

test.use({ storageState: { cookies: [], origins: [] } });
// Cleanup waits for any background triage to finish, which can take longer
// than the default 30 seconds; a cleanup cut short leaves accounts behind.
test.describe.configure({ timeout: 120_000 });

function service() {
  return createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("SUPABASE_SERVICE_ROLE_KEY"), {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

// Deletes a test account and its tickets. A filed request starts triage in
// the background, so it waits while that runs; one that stays pending a few
// seconds never started (a request filed by calling the function directly).
async function removeAccount(id: string) {
  const admin = service();
  const { data: open } = await admin.from("tickets").select("id").eq("customer_id", id);
  for (const t of open ?? []) {
    for (let i = 0; i < 60 && process.env.OPENROUTER_API_KEY; i++) {
      const { data: state } = await admin.from("ticket_triage_state").select("triage_status").eq("ticket_id", t.id).maybeSingle();
      const status = state?.triage_status ?? "pending";
      if (status === "completed" || status === "failed" || (status === "pending" && i >= 3)) break;
      await new Promise((r) => setTimeout(r, 1_000));
    }
  }
  await admin.from("tickets").delete().eq("customer_id", id);
  await admin.auth.admin.deleteUser(id);
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
    remove: () => removeAccount(id),
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

test("the Get in touch form asks the optional questions; a plain sign-up doesn't", async ({ page }) => {
  await page.goto("/signup?access=1");
  await expect(page.getByRole("heading", { name: "Get in touch" })).toBeVisible();
  await expect(page.getByLabel("Team or company name")).toBeVisible();
  await expect(page.getByLabel("Team size")).toBeVisible();
  await expect(page.getByLabel("What would you use it for?")).toBeVisible();
  await expect(page.getByRole("button", { name: "Sign up and send" })).toBeVisible();

  await page.goto("/signup");
  await expect(page.getByRole("heading", { name: "Create an account" })).toBeVisible();
  // A plain sign-up names its new workspace (SUP-82), but asks none of the
  // Get in touch questions.
  await expect(page.getByLabel("Team size")).toHaveCount(0);
  await expect(page.getByLabel("What would you use it for?")).toHaveCount(0);

  // Every homepage "Get in touch" button leads to the form with the questions.
  await page.goto("/welcome");
  for (const href of await page.getByRole("link", { name: "Get in touch", exact: true }).evaluateAll((links) => links.map((a) => a.getAttribute("href")))) {
    expect(href).toBe("/signup?access=1");
  }
});

test("the first sign-in files exactly one access-request ticket, as the customer, and says thanks", async ({ page }) => {
  const user = await newAccount({ access_request: ANSWERS });
  try {
    await login(page, user.email, user.password);
    await expect(page).toHaveURL(/\/tickets\?requested=1$/);
    await expect(page.getByRole("status")).toContainText("Thanks for getting in touch.");
    await expect(page.getByRole("link", { name: /Getting in touch: Acme Robotics/ })).toBeVisible();

    const tickets = await user.tickets();
    expect(tickets).toHaveLength(1);
    expect(tickets[0]).toMatchObject({ subject: "Getting in touch: Acme Robotics", customer_id: user.id });
    expect(tickets[0].body).toContain("Team size: 6-20");
    expect(tickets[0].body).toContain("What we'd use it for: Triage our support inbox.");

    // Signing in again files nothing more, and the role is still customer.
    await page.getByRole("button", { name: "Sign out" }).click();
    await login(page, user.email, user.password);
    expect(new URL(page.url()).pathname).toBe("/");
    expect(await user.tickets()).toHaveLength(1);
    const { data: profile } = await service()
      .from("profiles")
      .select("access_requested_at, membership:workspace_members(role)")
      .eq("id", user.id)
      .single();
    expect(profile!.membership).toEqual({ role: "customer" });
    expect(profile!.access_requested_at).not.toBeNull();
    // Filed, so the copy kept with the sign-in is gone.
    const { data: account } = await service().auth.admin.getUserById(user.id);
    expect(account.user!.user_metadata.access_request).toBeUndefined();
  } finally {
    await user.remove();
  }
});

test("signing up through Get in touch files the request straight away when the email is confirmed automatically", async ({ page }) => {
  // This project confirms emails automatically, so sign-up signs the person
  // in at once and no email is sent (SUP-69). Locally there's no per-IP
  // sign-up limit (the dev server sees no visitor IP), and each run uses a
  // new email, so repeated runs don't trip the limiter.
  const email = `e2e-access-signup-${Date.now()}-${randomUUID().slice(0, 8)}@example.com`;
  const admin = service();
  try {
    await page.goto("/signup?access=1");
    await page.getByPlaceholder("Email").fill(email);
    await page.getByPlaceholder("Password").fill(`Pw-${randomUUID()}`);
    await page.getByLabel("Team or company name").fill("Globex Support");
    await page.getByLabel("Team size").selectOption("21-100");
    await page.getByLabel("What would you use it for?").fill("Triage a busy inbox.");
    await page.getByRole("button", { name: "Sign up and send" }).click();

    // If the project starts requiring email confirmation, sign-up waits for
    // the email instead; the confirmation-link test below covers that path.
    await page.waitForURL(/\/(tickets\?requested=1|login\?confirmEmail=1)$/, { timeout: 15_000 });
    test.skip(page.url().includes("confirmEmail"), "The project requires email confirmation");
    await expect(page).toHaveURL(/\/tickets\?requested=1$/);
    await expect(page.getByRole("status")).toContainText("Thanks for getting in touch.");
    const { data: profile } = await admin
      .from("profiles")
      .select("id, access_request_status, membership:workspace_members(role)")
      .eq("email", email)
      .single();
    expect(profile).toMatchObject({ membership: { role: "customer" }, access_request_status: "pending" });
    const { data: tickets } = await admin.from("tickets").select("subject, body").eq("customer_id", profile!.id);
    expect(tickets).toEqual([
      expect.objectContaining({ subject: "Getting in touch: Globex Support", body: expect.stringContaining("Team size: 21-100") }),
    ]);
  } finally {
    const { data: profile } = await admin.from("profiles").select("id").eq("email", email).maybeSingle();
    if (profile) await removeAccount(profile.id);
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
    expect(tickets.map((t) => t.subject)).toEqual(["Getting in touch"]);
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

test("access requests never form or join a possible incident, and are never suggested as duplicates", async () => {
  test.setTimeout(120_000);
  const admin = service();
  // Three requesters and three ordinary customers, every ticket with the
  // same embedding: as alike as tickets can be (SUP-70).
  const requesters = await Promise.all([1, 2, 3].map(() => newAccount({ access_request: ANSWERS })));
  const customers = await Promise.all([1, 2, 3].map(() => newAccount(undefined)));
  const same = `[${Array.from({ length: 1536 }, (_, i) => (i === 0 ? 1 : 0)).join(",")}]`;
  const embed = async (id: string) =>
    expect((await admin.from("ticket_embeddings").insert({ ticket_id: id, embedding: same, embedding_model: "test" })).error).toBeNull();
  const detect = async (id: string) => {
    const { data, error } = await admin.rpc("detect_incident", {
      p_ticket_id: id,
      p_threshold: INCIDENT_SIMILARITY,
      p_window_minutes: INCIDENT_WINDOW_MINUTES,
      p_min_tickets: INCIDENT_MIN_TICKETS,
    });
    expect(error).toBeNull();
    return data as { incident_id: string }[];
  };
  try {
    const requests: string[] = [];
    for (const p of requesters) {
      const db = createClient(requireEnv("NEXT_PUBLIC_SUPABASE_URL"), requireEnv("NEXT_PUBLIC_SUPABASE_ANON_KEY"), {
        db: { schema: "ticketing" },
        auth: { persistSession: false, autoRefreshToken: false },
      });
      expect((await db.auth.signInWithPassword({ email: p.email, password: p.password })).error).toBeNull();
      const id = ((await db.rpc("file_access_request")).data as { ticket_id: string }[])[0].ticket_id;
      // Marked on the ticket itself.
      expect((await admin.from("tickets").select("is_access_request").eq("id", id).single()).data!.is_access_request).toBe(true);
      requests.push(id);
      await embed(id);
    }
    // Three access requests: no incident.
    for (const id of requests) expect(await detect(id)).toEqual([]);

    // A real ticket next to them doesn't pull them in either (they aren't
    // neighbours), and they aren't offered as its duplicates.
    const real: string[] = [];
    const fileReal = async (customerId: string) => {
      const { data } = await admin.from("tickets").insert({ customer_id: customerId, subject: "Webhooks stopped", body: "No events since noon." }).select("id").single();
      real.push(data!.id);
      await embed(data!.id);
      return data!.id;
    };
    // With only the three access requests around it, a real ticket has no
    // neighbours: no incident.
    expect(await detect(await fileReal(customers[0].id))).toEqual([]);
    const { data: matches } = await admin.rpc("match_tickets", { query_embedding: same, match_count: 20, exclude_ticket_id: real[0] });
    const offered = (matches as { ticket_id: string }[]).map((m) => m.ticket_id);
    for (const id of requests) expect(offered).not.toContain(id);

    // Positive control: with two more real tickets alike, they do group.
    await fileReal(customers[1].id);
    const grouped = await detect(await fileReal(customers[2].id));
    expect(grouped).toHaveLength(1);
    const { data: members } = await admin.from("incident_tickets").select("ticket_id").eq("incident_id", grouped[0].incident_id);
    const memberIds = (members ?? []).map((m) => m.ticket_id);
    expect(memberIds.sort()).toEqual([...real].sort());
    for (const id of requests) expect(memberIds).not.toContain(id);
  } finally {
    await Promise.all([...requesters, ...customers].map((p) => p.remove()));
  }
});
