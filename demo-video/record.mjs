// Records the demo video's scenes (SUP-44) by driving the app on
// localhost:3000 with the project's test accounts, the way a person giving
// the demo would. Each scene is captured as JPEG frames through the Chrome
// DevTools screencast into demo-video/build/frames/<scene>/, together with:
//   - frames.json: a timestamp per frame;
//   - camera.json: where the camera should look and how close (cam() calls),
//     which build.py turns into smooth zooms and pans;
//   - mouse.json: the cursor's moves and clicks.
//
//   npm run build && npm run start          # in another terminal
//   node --env-file=.env.local demo-video/record.mjs              # every scene
//   node --env-file=.env.local demo-video/record.mjs 03 04        # some scenes
//
// The cursor and click ripples aren't in the page: build.py draws them from
// mouse.json, so they move smoothly at 30 fps.
//
// It changes live data like a real demo: it files one new ticket as test
// customer B (replacing the previous take's), and reviews, claims, answers,
// moves, flags, labels, shares, resolves and rates it as the test admin.
// It keeps one "Refund policy" note on the admin for Sage. The agent's theme
// switch in the montage is put back afterwards. That data is the shared
// Supabase project's (the same database as notes-collections), so the newest
// ticket in the queue after a take is the demo's.
//
// This is a dev-only Node script, never part of the app: it uses the
// service-role key directly (outside app/lib/supabase/service.ts and
// app/lib/db/) to set up and reset scene state, scoped to the test accounts
// and the one ticket it files.
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";
const ROOT = dirname(fileURLToPath(import.meta.url));
const BUILD = join(ROOT, "build");
const STATE = join(BUILD, "state.json");
// The screencast captures CSS pixels, so the page is laid out at 2880x1620
// and zoomed 2.25x: the layout of a 1280x720 window, captured at 1.5x the
// final 1080p so the camera can zoom in and stay sharp.
const VIEWPORT = { width: 2880, height: 1620 };
const ZOOM = 2.25;

for (const name of ["NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_ANON_KEY", "SUPABASE_SERVICE_ROLE_KEY", "TEST_USER_B_EMAIL", "TEST_AGENT_EMAIL", "TEST_ADMIN_EMAIL", "TEST_ADMIN_PASSWORD"]) {
  if (!process.env[name]) throw new Error(`${name} is not set: run with node --env-file=.env.local`);
}
const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "ticketing" },
  auth: { persistSession: false, autoRefreshToken: false },
});

const ACCOUNTS = {
  customer: ["TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD"],
  agent: ["TEST_AGENT_EMAIL", "TEST_AGENT_PASSWORD"],
  admin: ["TEST_ADMIN_EMAIL", "TEST_ADMIN_PASSWORD"],
};

const DEMO_TICKET = {
  subject: "Charged twice for Pro this month, need a refund",
  body:
    "Hi, I just noticed two charges of $29 for my Pro plan on my card this month. " +
    "This is the second time this has happened and I'm getting really frustrated. " +
    "Please refund the duplicate charge as soon as possible.",
};
const DEMO_NOTE = {
  title: "Refund policy",
  body:
    "Duplicate charges: refund the extra charge in full, no questions asked, within 2 business days. " +
    "Ask for the last 4 digits of the card and the invoice numbers. " +
    "Refunds over $100 need a team lead's approval.",
};
const SAGE_QUESTION = "What's our policy for refunding a duplicate charge?";

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
// The ticket 02-customer files, for the scenes that use it.
const demoTicket = () => {
  if (!state.ticketUrl) throw new Error("Record 02-customer first: this scene uses its ticket.");
  return { url: state.ticketUrl, number: state.ticketNumber };
};
// Moves the demo ticket through statuses one allowed step at a time (the
// status trigger applies to the service role too), checking each.
async function stepStatus(...statuses) {
  for (const status of statuses) {
    const { error } = await db.from("tickets").update({ status }).eq("number", demoTicket().number);
    if (error) throw new Error(`Demo ticket -> ${status}: ${error.message}`);
  }
}
// The demo ticket's current status.
const demoStatus = async () =>
  (await db.from("tickets").select("status").eq("number", demoTicket().number).single()).data.status;
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));
const profileId = async (role) =>
  (await db.from("profiles").select("id").eq("email", process.env[ACCOUNTS[role][0]].toLowerCase()).single()).data.id;

// ---- recording helpers -------------------------------------------------

const pause = (page, ms) => page.waitForTimeout(ms);

// Camera keyframes for build.py: look at a locator (or the whole window,
// with null) from now on. `zoom` caps how close it gets.
let camera = [];
// The cursor is drawn by build.py from this log (smooth at 30 fps whatever
// the capture rate): each move's start and end, and each click.
let mouse = [];
let scrolls = [];
let mousePos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
async function mouseTo(page, x, y, steps = 24) {
  mouse.push({ t: Date.now() / 1000, x: mousePos.x, y: mousePos.y });
  await page.mouse.move(x, y, { steps });
  mousePos = { x, y };
  mouse.push({ t: Date.now() / 1000, x, y });
}
async function cam(page, locator, { zoom = 2.0, pad = 60 } = {}) {
  if (!locator) {
    camera.push({ t: Date.now() / 1000, x: VIEWPORT.width / 2, y: VIEWPORT.height / 2, zoom: 1 });
    return;
  }
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox().catch(() => null);
  // Off-screen (or mis-measured under page zoom): keep the camera where it is.
  if (!box || box.x < 0 || box.y < 0 || box.x + box.width > VIEWPORT.width || box.y + box.height > VIEWPORT.height) return;
  const p = pad * ZOOM;
  const fit = Math.min(VIEWPORT.width / (box.width + 2 * p), VIEWPORT.height / (box.height + 2 * p));
  camera.push({
    t: Date.now() / 1000,
    x: box.x + box.width / 2,
    y: box.y + box.height / 2,
    zoom: Math.max(1, Math.min(zoom, fit)),
  });
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await mouseTo(page, box.x + Math.min(box.width / 2, 60 * ZOOM), box.y + box.height / 2);
  await pause(page, 250);
}

async function click(page, locator) {
  await moveTo(page, locator);
  mouse.push({ t: Date.now() / 1000, x: mousePos.x, y: mousePos.y, click: true });
  try {
    // At the cursor, not the element's centre, so the drawn cursor is right.
    const box = await locator.boundingBox();
    await locator.click({ timeout: 4000, position: box ? { x: mousePos.x - box.x, y: mousePos.y - box.y } : undefined });
  } catch {
    // Page zoom can make Playwright think a popup item is off screen.
    await locator.evaluate((el) => el.click());
  }
  await pause(page, 400);
}

async function type(page, locator, text, delay = 24) {
  await click(page, locator);
  await locator.pressSequentially(text, { delay });
  await pause(page, 300);
}

// Eased scroll of whatever scrolls the page, so it reads on video: brings
// the element near the top.
async function scrollToLocator(page, locator, ms = 1200) {
  const handle = await locator.elementHandle();
  const t0 = Date.now() / 1000;
  await page.evaluate(
    async ({ el, ms }) => {
      const box = [...document.querySelectorAll("main, body *")].find(
        (n) => n.scrollHeight > n.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(n).overflowY),
      ) || document.scrollingElement;
      const from = box.scrollTop;
      const to = from + el.getBoundingClientRect().top - 90;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          box.scrollTop = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
          if (k < 1) requestAnimationFrame(step);
          else done();
        };
        requestAnimationFrame(step);
      });
    },
    { el: handle, ms },
  );
  // Frames captured mid-scroll can tear; build.py dissolves across this span.
  scrolls.push({ from: t0, to: Date.now() / 1000 + 0.15 });
  await pause(page, 300);
}

// Signs in once per run (a saved session goes stale between runs).
const signedIn = new Set();
async function signIn(browser, role) {
  const file = join(BUILD, "auth", `${role}.json`);
  if (signedIn.has(role)) return file;
  signedIn.add(role);
  mkdirSync(dirname(file), { recursive: true });
  const [emailVar, passwordVar] = ACCOUNTS[role];
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("Email").fill(process.env[emailVar]);
  await page.getByPlaceholder("Password").fill(process.env[passwordVar]);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.getByRole("button", { name: "Sign out" }).waitFor({ timeout: 60_000 });
  await context.storageState({ path: file });
  await context.close();
  return file;
}

async function newPage(browser, role) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1,
    storageState: role ? await signIn(browser, role) : undefined,
    colorScheme: "light",
  });
  await context.addInitScript((zoom) => {
    const apply = () => (document.documentElement.style.zoom = String(zoom));
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", apply);
    else apply();
  }, ZOOM);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  return page;
}

// Runs setup unrecorded, records run() as frames plus camera keyframes,
// then runs teardown unrecorded.
async function record(browser, id, role, { setup, run, teardown }) {
  const page = await newPage(browser, role);
  mousePos = { x: VIEWPORT.width / 2, y: VIEWPORT.height / 2 };
  if (setup) await setup(page);
  await pause(page, 500);

  // A take records into a fresh folder and replaces the last good one only
  // when it finishes, so a failed re-take leaves that one as it was.
  const final = join(BUILD, "frames", id);
  const dir = `${final}.take`;
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await page.context().newCDPSession(page);
  const frames = [];
  const writes = [];
  cdp.on("Page.screencastFrame", ({ data, metadata, sessionId }) => {
    // Ack first: Chrome sends the next frame only after the ack, so writing
    // before it would cap the frame rate (large frames take a while to save).
    cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
    const file = `${String(frames.length).padStart(5, "0")}.jpg`;
    frames.push({ file, t: metadata.timestamp });
    writes.push(writeFile(join(dir, file), Buffer.from(data, "base64")));
  });
  camera = [];
  mouse = [];
  scrolls = [];
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 80 });
  await page.mouse.move(mousePos.x, mousePos.y);
  const started = Date.now() / 1000;
  mouse.push({ t: started, x: mousePos.x, y: mousePos.y });
  camera.push({ t: started, x: VIEWPORT.width / 2, y: VIEWPORT.height / 2, zoom: 1 });
  let ended;
  try {
    await run(page);
    await pause(page, 900);
    ended = Date.now() / 1000;
    await cdp.send("Page.stopScreencast");
    await Promise.all(writes);
  } finally {
    // Even after a failed take, so test accounts are always put back.
    if (teardown) await teardown(page);
  }
  writeFileSync(join(dir, "frames.json"), JSON.stringify({ started, ended, frames, size: VIEWPORT }, null, 1));
  writeFileSync(join(dir, "camera.json"), JSON.stringify(camera, null, 1));
  writeFileSync(join(dir, "mouse.json"), JSON.stringify(mouse, null, 1));
  writeFileSync(join(dir, "scrolls.json"), JSON.stringify(scrolls, null, 1));
  rmSync(final, { recursive: true, force: true });
  renameSync(dir, final);
  console.log(`${id}: ${frames.length} frames, ${(ended - started).toFixed(1)} s, ${camera.length} camera moves`);
  await page.context().close();
}

const ticketUrl = async (number) => {
  const { data, error } = await db.from("tickets").select("id").eq("number", number).single();
  if (error) throw new Error(`#${number}: ${error.message}`);
  return `${BASE}/tickets/${data.id}`;
};
const panelOf = (page) => page.locator("section").filter({ hasText: "AI triage" }).first();
const cardOf = (page, n) => page.getByRole("listitem").filter({ has: page.getByRole("button", { name: `Actions for #${n}` }) });

async function waitForTriage(page) {
  for (let i = 0; i < 45; i++) {
    await page.reload();
    if (await panelOf(page).getByText("completed", { exact: true }).isVisible().catch(() => false)) return;
    await pause(page, 2000);
  }
  throw new Error("AI triage did not complete in time");
}

// ---- the MCP scene's data and terminal ----------------------------------

// Calls /api/mcp as the test admin: the unassigned queue, most urgent first,
// then the first ticket on it. The token is revoked as soon as the two calls
// are done (30 days is just the shortest lifetime the app allows).
async function mcpCalls() {
  const user = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    db: { schema: "ticketing" },
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error: signInError } = await user.auth.signInWithPassword({
    email: process.env.TEST_ADMIN_EMAIL,
    password: process.env.TEST_ADMIN_PASSWORD,
  });
  if (signInError) throw new Error(`MCP scene sign-in: ${signInError.message}`);
  const { data: token, error } = await user.rpc("create_access_token", { p_name: "Demo video (SUP-73)", p_expires_in_days: 30 });
  if (error) throw new Error(`MCP scene token: ${error.message}`);
  let failed;
  try {
    const call = async (name, args) => {
      const res = await fetch(`${BASE}/api/mcp`, {
        method: "POST",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json", accept: "application/json, text/event-stream" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } }),
      });
      const body = await res.json();
      if (!res.ok || body.error || body.result?.isError) throw new Error(`${name}: ${res.status} ${JSON.stringify(body).slice(0, 300)}`);
      return JSON.parse(body.result.content[0].text);
    };
    const all = (await call("list_queue", { tab: "unassigned", sort: "sla" })).tickets;
    // Real tickets the AI has read, not access requests (by the tickets'
    // own flag, SUP-70, not their subjects).
    const { data: requests, error: flagError } = await db
      .from("tickets")
      .select("number")
      .eq("is_access_request", true)
      .in("number", all.map((t) => Number(t.number.slice(1))));
    if (flagError) throw new Error(`MCP scene: ${flagError.message}`);
    const skip = new Set(requests.map((r) => `#${r.number}`));
    const queue = all.filter((t) => t.ai && !skip.has(t.number));
    // The first of them with a draft reply (a failed reply call leaves none).
    let ticket;
    for (const t of queue) {
      ticket = await call("get_ticket", { number: Number(t.number.slice(1)) });
      if (ticket.triage?.draft_reply) break;
      ticket = null;
    }
    if (!ticket) throw new Error("MCP scene: no triaged unassigned ticket with a draft reply in the queue");
    return { queue: queue.slice(0, 3), ticket };
  } catch (e) {
    failed = e;
    throw e;
  } finally {
    // Revoked by id: the one token named for this scene (an earlier run's
    // leftover too). A token that can't be revoked would work for 30 days, so
    // that stops the run, after reporting the scene's own error if there was one.
    const { data: tokens, error: listError } = await user
      .from("access_tokens")
      .select("id")
      .eq("name", "Demo video (SUP-73)")
      .is("revoked_at", null);
    const left = listError ? [`(couldn't list tokens: ${listError.message})`] : [];
    for (const { id } of tokens ?? []) {
      const { error: revokeError } = await user.rpc("revoke_access_token", { p_id: id });
      if (revokeError) left.push(`${id} (${revokeError.message})`);
    }
    await user.auth.signOut();
    if (left.length) {
      if (failed) console.error(failed);
      throw new Error(`MCP scene: token NOT revoked: ${left.join(", ")}. Revoke it on the test admin's Account page.`);
    }
  }
}

// Laid out for a 1280x720 window, like the app's scenes (page zoom ZOOM).
const TERMINAL_HTML = `<!doctype html><html style="zoom:${ZOOM}"><head><meta charset="utf-8"><style>
  html, body { margin: 0; height: 720px; background: #f4f4f5; }
  body { display: grid; place-items: center; font: 15px/1.55 ui-monospace, "SF Mono", Menlo, monospace; }
  #term { width: 1040px; min-height: 600px; border-radius: 12px; background: #18181b; color: #e4e4e7; overflow: hidden;
    box-shadow: 0 20px 50px rgba(0,0,0,.25); display: flex; flex-direction: column; }
  .bar { display: flex; align-items: center; gap: 8px; padding: 12px 16px; background: #27272a; color: #a1a1aa; font-size: 13px; }
  .bar i { width: 12px; height: 12px; border-radius: 50%; background: #52525b; display: inline-block; }
  .bar span { margin-left: 10px; }
  .body { padding: 18px 24px; display: flex; flex-direction: column; gap: 12px; }
  .prompt { display: flex; gap: 10px; color: #fafafa; }
  .prompt b { color: #a78bfa; }
  #ask { flex: 1; background: none; border: 0; outline: none; color: inherit; font: inherit; padding: 0; caret-color: #a78bfa; }
  .step { opacity: 0; transform: translateY(6px); transition: opacity .35s, transform .35s; }
  .step.shown { opacity: 1; transform: none; }
  .call { color: #a1a1aa; }
  .call b { color: #34d399; font-weight: 600; }
  .call em { font-style: normal; color: #71717a; }
  .said p { margin: 0 0 4px; }
  .said ul { margin: 2px 0 0; padding-left: 4px; list-style: none; }
  .said li::before { content: "• "; }
  .said li { margin: 2px 0; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clamp { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  .num { color: #a78bfa; }
  .meta { color: #a1a1aa; }
  #draft { margin-top: 8px; border: 1px solid #3f3f46; border-radius: 8px; padding: 10px 14px; color: #d4d4d8; }
  #draft .label { color: #fbbf24; font-size: 12px; letter-spacing: .04em; text-transform: uppercase; margin-bottom: 4px; }
  #draft .text { display: -webkit-box; -webkit-line-clamp: 4; -webkit-box-orient: vertical; overflow: hidden; }
</style></head><body>
  <div id="term">
    <div class="bar"><i></i><i></i><i></i><span>AI assistant · connected to Support Triage over MCP</span></div>
    <div class="body">
      <div class="prompt"><b>&gt;</b><input id="ask" aria-label="Message" autofocus></div>
      <div id="call-queue" class="step call">● <b>support-triage</b> · list_queue <em>(unassigned, most urgent first)</em></div>
      <div id="said-queue" class="step said"></div>
      <div id="call-ticket" class="step call"></div>
      <div id="said-ticket" class="step said"></div>
    </div>
  </div>
</body></html>`;

// Runs in the page: fills the steps from the tools' results, as text (a
// ticket's words are never parsed as HTML).
function fillTerminal({ queue, ticket }) {
  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };
  const sla = { breached: "past its response target", at_risk: "due soon", on_track: "on time", met: "answered in time", missed: "answered late" };
  const said = document.getElementById("said-queue");
  said.append(el("p", null, `${queue.length === 1 ? "One ticket needs" : `${queue.length} tickets need`} someone first:`));
  const list = el("ul");
  for (const t of queue) {
    const li = el("li");
    li.append(el("span", "num", t.number), ` ${t.subject.untrusted_text} `);
    const bits = [t.priority, t.sla && sla[t.sla.state], t.ai.escalation_risk && "escalation risk"].filter(Boolean);
    li.append(el("span", "meta", `· ${bits.join(" · ")}`));
    list.append(li);
  }
  said.append(list);

  const call = document.getElementById("call-ticket");
  call.append("● ", el("b", null, "support-triage"), ` · get_ticket `, el("em", null, `(${ticket.number})`));

  const read = document.getElementById("said-ticket");
  const tr = ticket.triage;
  const p = el("p", "clamp");
  p.append(el("span", "num", ticket.number), ` ${tr.summary.untrusted_text}`);
  read.append(p);
  // The working values (the AI's, or a reviewer's correction); null until set.
  const rated = [tr.priority && `${tr.priority} priority`, tr.team && `for the ${tr.team} team`].filter(Boolean).join(", ");
  read.append(el("p", "meta", `${rated ? `It's ${rated}. ` : ""}Here's the AI's draft reply:`));
  const draft = el("div");
  draft.id = "draft";
  draft.append(el("div", "label", "Draft only · not sent until you post it"), el("div", "text", tr.draft_reply.text.untrusted_text));
  read.append(draft);
}

// ---- scenes ------------------------------------------------------------

const SCENES = {
  "02-customer": ["customer", {
    setup: async (page) => {
      // Replace the previous take's demo ticket.
      await db.from("tickets").delete().eq("customer_id", await profileId("customer")).eq("subject", DEMO_TICKET.subject);
      await page.goto(`${BASE}/tickets/new`);
    },
    run: async (page) => {
      await pause(page, 600);
      const subject = page.getByPlaceholder("Subject");
      await cam(page, subject.locator("xpath=ancestor::form[1]"), { zoom: 1.8 });
      await type(page, subject, DEMO_TICKET.subject, 30);
      await type(page, page.getByPlaceholder("Describe what's going on..."), DEMO_TICKET.body, 10);
      await click(page, page.getByRole("button", { name: "Submit ticket" }));
      await page.getByRole("heading", { name: DEMO_TICKET.subject }).waitFor();
      await cam(page, null);
      state.ticketUrl = page.url();
      const { data } = await db.from("tickets").select("number").eq("id", page.url().split("/").pop()).single();
      state.ticketNumber = data.number;
      saveState();
      await pause(page, 1500);
    },
  }],

  "03-triage": ["admin", {
    setup: async (page) => {
      await page.goto(demoTicket().url);
      await waitForTriage(page);
    },
    run: async (page) => {
      const panel = panelOf(page);
      await pause(page, 900);
      await scrollToLocator(page, panel, 1000);
      await cam(page, panel, { zoom: 1.6 });
      await pause(page, 1200);
      const fields = panel.getByRole("term").filter({ hasText: /^Category$/ }).locator("xpath=ancestor::dl[1]");
      await cam(page, fields, { zoom: 2.2 });
      for (const term of ["Category", "Priority", "Team", "Frustration"]) {
        await moveTo(page, panel.getByRole("term").filter({ hasText: new RegExp(`^${term}$`) }).first());
        await pause(page, 800);
      }
      const missing = panel.getByText(/still needed/i).first();
      if (await missing.isVisible().catch(() => false)) {
        await cam(page, missing.locator("xpath=.."), { zoom: 2.2 });
        await moveTo(page, missing);
        await pause(page, 1600);
      }
      const reply = panel.getByText(/^Suggested reply/).first();
      await scrollToLocator(page, reply, 900);
      await cam(page, reply.locator("xpath=.."), { zoom: 2.0 });
      await pause(page, 2400);
      const cost = panel.getByText(/\$0\.\d+/).first();
      await cam(page, cost, { zoom: 2.2, pad: 120 });
      await moveTo(page, cost);
      await pause(page, 1600);
      await cam(page, null);
      await pause(page, 600);
    },
  }],

  "04-sage": ["admin", {
    setup: async (page) => {
      // Sage answers from the admin's own "Refund policy" note. Tests can
      // remove it, so make sure it's there (unrecorded: the UI embeds it).
      const owner = await profileId("admin");
      const { data } = await db.from("notes").select("id").eq("owner_id", owner).eq("title", DEMO_NOTE.title);
      if (!data?.length) {
        await page.goto(`${BASE}/notes/new`);
        await page.getByPlaceholder("Title").fill(DEMO_NOTE.title);
        await page.getByPlaceholder("Write the note...").fill(DEMO_NOTE.body);
        await page.getByRole("button", { name: "Save note" }).click();
        await page.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 60_000 });
      }
      await page.goto(demoTicket().url);
    },
    run: async (page) => {
      await pause(page, 700);
      const launcher = page.getByRole("button", { name: "Open Sage" });
      await cam(page, launcher, { zoom: 1.8, pad: 260 });
      await click(page, launcher);
      // Show it as a fresh chat: hide this account's earlier (test) turns.
      await page.getByTestId("assistant-widget-message").first().waitFor().catch(() => {});
      await page.evaluate(() => {
        const first = document.querySelector('[data-testid="assistant-widget-message"]');
        const list = first?.parentElement?.parentElement;
        for (const child of list ? [...list.children] : []) child.style.display = "none";
      });
      const input = page.getByPlaceholder("Message Sage...");
      const widget = page.getByText("AI assistant, private to you").locator("xpath=ancestor::*[.//textarea or .//input][1]");
      await cam(page, widget, { zoom: 2.0, pad: 30 });
      await pause(page, 500);
      await type(page, input, SAGE_QUESTION, 28);
      const answers = page.getByTestId("assistant-widget-message").filter({ hasText: /Refund policy/ });
      const before = await answers.count();
      await click(page, page.getByRole("button", { name: "Send" }));
      await answers.nth(before).waitFor({ timeout: 120_000 });
      await pause(page, 500);
      await cam(page, answers.nth(before), { zoom: 2.4, pad: 40 });
      const question = page.getByTestId("assistant-widget-message").filter({ hasText: SAGE_QUESTION }).last();
      await question.evaluate((el) => {
        let box = el.parentElement;
        while (box && box.scrollHeight <= box.clientHeight + 4) box = box.parentElement;
        if (box) box.scrollTo({ top: el.offsetTop - box.offsetTop - 12, behavior: "smooth" });
      });
      await pause(page, 4200);
      await cam(page, null);
      await pause(page, 500);
    },
  }],

  "05-review": ["admin", {
    setup: async (page) => {
      // A re-take starts unclaimed (as after 02), so "Claim ticket" is there.
      const path = { resolved: ["in_progress", "assigned", "triaged"], in_progress: ["assigned", "triaged"], assigned: ["triaged"] };
      await stepStatus(...(path[await demoStatus()] ?? []));
      const { error } = await db.from("tickets").update({ assignee_id: null }).eq("number", demoTicket().number);
      if (error) throw new Error(error.message);
      await page.goto(demoTicket().url);
    },
    run: async (page) => {
      const panel = panelOf(page);
      const review = panel.getByText("Your review");
      await scrollToLocator(page, review, 900);
      await cam(page, review.locator("xpath=.."), { zoom: 2.1 });
      const priority = panel.getByLabel("Priority");
      const current = await priority.inputValue();
      await moveTo(page, priority);
      await priority.selectOption(current === "urgent" ? "high" : "urgent");
      await pause(page, 700);
      await click(page, panel.getByRole("button", { name: /Save correction|Save triage|Confirm AI triage/ }));
      await panel.getByRole("status").waitFor();
      await pause(page, 1300);
      await cam(page, null);
      const claim = page.getByRole("button", { name: "Claim ticket" });
      await click(page, claim);
      await page.getByText("Assigned to you").first().waitFor();
      await pause(page, 600);
      const use = page.getByRole("button", { name: /Use suggested reply/ });
      await scrollToLocator(page, use, 900);
      await cam(page, use.locator("xpath=ancestor::form[1]"), { zoom: 1.7 });
      await click(page, use);
      await pause(page, 1600);
      await click(page, page.getByRole("button", { name: "Add comment" }));
      await pause(page, 1400);
      await cam(page, null);
      await pause(page, 600);
    },
  }],

  "06-queue": ["admin", {
    setup: async (page) => {
      const { data: t } = await db.from("tickets").select("id").eq("number", demoTicket().number).single();
      await db.from("ticket_flags").delete().eq("ticket_id", t.id);
      await db.from("ticket_labels").delete().eq("ticket_id", t.id);
      // As it was after scene 05's claim (a re-take may come after the montage
      // resolved it): reopened, then back to assigned, the moves the app allows.
      const { data: cur } = await db.from("tickets").select("status").eq("id", t.id).single();
      for (const status of cur.status === "resolved" ? ["in_progress", "assigned"] : cur.status === "in_progress" ? ["assigned"] : []) {
        const { error } = await db.from("tickets").update({ status }).eq("id", t.id);
        if (error) throw new Error(error.message);
      }
      await page.goto(`${BASE}/queue?filter=all`);
    },
    run: async (page) => {
      const n = demoTicket().number;
      await pause(page, 900);
      const stats = page.getByText("SLA at risk").first().locator("xpath=ancestor::div[2]");
      await cam(page, stats, { zoom: 1.7 });
      await moveTo(page, page.getByText("SLA at risk").first());
      await pause(page, 900);
      await moveTo(page, page.getByText("SLA breached").first());
      await pause(page, 800);
      const atRisk = page.getByText(/At risk · reply in/).first();
      await cam(page, atRisk.locator("xpath=ancestor::li[1]"), { zoom: 2.0 });
      await moveTo(page, atRisk);
      await pause(page, 1300);
      await cam(page, null);
      await page.goto(`${BASE}/queue?filter=all&q=%23${n}`);
      await pause(page, 600);
      const card = cardOf(page, n);
      await cam(page, card, { zoom: 2.0, pad: 140 });
      await click(page, page.getByRole("button", { name: `Actions for #${n}` }));
      const menu = page.getByRole("menu").first();
      await cam(page, menu, { zoom: 2.0, pad: 40 });
      await pause(page, 700);
      for (const item of ["Set priority…", "Labels…", "Re-run AI triage"]) {
        await moveTo(page, page.getByRole("menuitem", { name: item }));
        await pause(page, 350);
      }
      await click(page, page.getByRole("menuitem", { name: "Flag to follow up" }));
      await page.getByRole("status").filter({ hasText: `Flagged #${n}` }).waitFor();
      // (Not the label picker: it positions itself from screen coordinates,
      // which the recording's page zoom throws off.)
      await cam(page, card, { zoom: 2.0, pad: 140 });
      await pause(page, 1600);
      await cam(page, null);
      await pause(page, 400);
    },
  }],

  "07-board": ["admin", {
    setup: async (page) => {
      // A re-take starts from "assigned" (as after the claim).
      if ((await demoStatus()) === "in_progress") await stepStatus("assigned");
      await page.goto(`${BASE}/board`);
    },
    run: async (page) => {
      const n = demoTicket().number;
      const card = page.locator("article", { hasText: DEMO_TICKET.subject }).first();
      const target = page.getByRole("region", { name: /^In progress, \d+ tickets?$/ });
      await pause(page, 700);
      await moveTo(page, card);
      await pause(page, 500);
      const tb = await target.boundingBox();
      await mouseTo(page, tb.x + tb.width / 2, tb.y + 140 * ZOOM, 30);
      const dt = await page.evaluateHandle(() => new DataTransfer());
      await card.dispatchEvent("dragstart", { dataTransfer: dt });
      await target.dispatchEvent("dragover", { dataTransfer: dt });
      await target.dispatchEvent("drop", { dataTransfer: dt });
      await card.dispatchEvent("dragend", { dataTransfer: dt });
      await page.getByRole("status").filter({ hasText: `Moved #${n} to In progress.` }).waitFor();
      await cam(page, target, { zoom: 1.6, pad: 40 });
      await pause(page, 2200);
      await cam(page, null);
      await pause(page, 500);
    },
  }],

  "08-learning": ["admin", {
    setup: async (page) => page.goto(await ticketUrl(4190)),
    run: async (page) => {
      const summary = page.getByText(/✦ Used \d+ past corrections? as examples/);
      await scrollToLocator(page, panelOf(page), 900);
      await cam(page, panelOf(page), { zoom: 1.6 });
      await pause(page, 600);
      await moveTo(page, summary);
      await summary.click();
      await pause(page, 500);
      await cam(page, summary.locator("xpath=.."), { zoom: 2.1, pad: 30 });
      await pause(page, 1200);
      await moveTo(page, page.getByText(/→/).first());
      await pause(page, 1600);
      await moveTo(page, page.getByRole("button", { name: "Don't learn from this" }).first());
      await pause(page, 1800);
      await cam(page, null);
      await pause(page, 400);
    },
  }],

  "09-incident": ["admin", {
    setup: (page) => page.goto(`${BASE}/queue`),
    run: async (page) => {
      const banner = page.getByRole("region", { name: "Open incidents" });
      await pause(page, 600);
      await cam(page, banner, { zoom: 2.0, pad: 30 });
      await moveTo(page, banner.getByRole("link", { name: /View INC-/ }).first());
      await pause(page, 1300);
      await click(page, banner.getByRole("link", { name: /View INC-/ }).first());
      const heading = page.getByRole("heading", { name: "Update every affected customer" });
      await heading.waitFor();
      await cam(page, null);
      await pause(page, 1400);
      const section = heading.locator("xpath=ancestor::section[1]");
      await scrollToLocator(page, heading, 1000);
      await cam(page, section, { zoom: 1.8 });
      await moveTo(page, page.getByLabel("Update text"));
      await pause(page, 1600);
      await click(page, page.getByRole("button", { name: "Post update…" }));
      await moveTo(page, page.getByRole("button", { name: /^Post to \d+ tickets?$/ }));
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: "Cancel" }));
      await cam(page, null);
      await pause(page, 600);
    },
  }],

  "10-analytics": ["admin", {
    setup: (page) => page.goto(`${BASE}/analytics`),
    run: async (page) => {
      await pause(page, 900);
      const stats = page.getByText("AI triage accepted as-is").first().locator("xpath=ancestor::div[3]");
      await cam(page, stats, { zoom: 1.6 });
      await pause(page, 1800);
      await cam(page, null);
      const learning = page.getByRole("heading", { name: "Is the AI learning?" });
      await scrollToLocator(page, learning, 1300);
      await cam(page, learning.locator("xpath=.."), { zoom: 1.5 });
      await pause(page, 2200);
      await cam(page, null);
      await scrollToLocator(page, page.getByRole("heading", { name: "Team performance" }), 1300);
      await pause(page, 1300);
    },
  }],

  // MCP (SUP-73): an AI assistant asked "What's waiting for me?" works the
  // queue through /api/mcp. The tool calls are real, made as the test admin
  // with a token that lives only for this setup (revoked straight after).
  // The terminal is a plain styled page, not any one product's interface,
  // and the assistant's words are put together from what the tools returned.
  "10b-mcp": [null, {
    setup: async (page) => {
      const { queue, ticket } = await mcpCalls();
      await page.setContent(TERMINAL_HTML);
      await page.evaluate(fillTerminal, { queue, ticket });
    },
    run: async (page) => {
      mouse.splice(0); // no cursor: nothing is clicked in a terminal
      const term = page.locator("#term");
      await cam(page, term, { zoom: 1.25, pad: 20 });
      await pause(page, 500);
      await page.locator("#ask").pressSequentially("What's waiting for me?", { delay: 55 });
      await pause(page, 500);
      for (const step of ["call-queue", "said-queue", "call-ticket", "said-ticket"]) {
        await page.evaluate((id) => document.getElementById(id).classList.add("shown"), step);
        await pause(page, step.startsWith("call") ? 900 : 1700);
      }
      await cam(page, page.locator("#draft"), { zoom: 1.7, pad: 30 });
      await pause(page, 2600);
      await cam(page, term, { zoom: 1.25, pad: 20 });
      await pause(page, 800);
    },
  }],

  // ---- montage: short shots, one caption each ----

  "11-m01-on-behalf": ["admin", {
    setup: (page) => page.goto(`${BASE}/tickets/new`),
    run: async (page) => {
      await cam(page, page.getByLabel("Customer email").locator("xpath=ancestor::form[1]"), { zoom: 1.7 });
      await type(page, page.getByLabel("Customer email"), "customer@example.com", 25);
      await type(page, page.getByLabel("Subject"), "Called in: can't export invoices", 18);
      await moveTo(page, page.getByRole("button", { name: "Create ticket" }));
      await pause(page, 500);
    },
  }],

  "11-m02-csat": ["customer", {
    setup: async (page) => {
      // Staff resolve the demo ticket first (unrecorded).
      // (The trigger sets resolved_at.)
      const path = { new: ["in_progress", "resolved"], triaged: ["in_progress", "resolved"], assigned: ["in_progress", "resolved"], in_progress: ["resolved"] };
      await stepStatus(...(path[await demoStatus()] ?? []));
      await page.goto(demoTicket().url);
    },
    run: async (page) => {
      const heading = page.getByRole("heading", { name: /How did we do\?|Your rating/ });
      await scrollToLocator(page, heading, 600);
      await cam(page, heading.locator("xpath=.."), { zoom: 2.0 });
      await moveTo(page, page.getByLabel(/^5 stars/).first());
      mouse.push({ t: Date.now() / 1000, x: mousePos.x, y: mousePos.y, click: true });
      // The radio is visually hidden behind its star; page zoom trips Playwright's check().
      await page.getByLabel(/^5 stars/).evaluate((el) => el.click());
      await pause(page, 400);
      await click(page, page.getByRole("button", { name: /Send rating|Update rating/ }));
      await pause(page, 900);
    },
  }],

  "11-m03-share": ["admin", {
    setup: (page) => page.goto(demoTicket().url),
    run: async (page) => {
      const publish = page.getByRole("button", { name: "Publish public status page" });
      if (await publish.isVisible().catch(() => false)) {
        await scrollToLocator(page, publish, 600);
        await cam(page, publish, { zoom: 2.0, pad: 120 });
        await click(page, publish);
      }
      const url = await page.locator("code").filter({ hasText: "/s/" }).first().innerText();
      await pause(page, 400);
      await page.goto(url.startsWith("http") ? url : `${BASE}${url}`);
      await cam(page, page.getByText(/ticket status/i).first().locator("xpath=ancestor::div[2]"), { zoom: 1.6 });
      await pause(page, 1300);
    },
  }],

  "11-m04-labels": ["admin", {
    setup: (page) => page.goto(`${BASE}/labels`),
    run: async (page) => {
      await cam(page, page.getByLabel("New label name").locator("xpath=ancestor::form[1]"), { zoom: 1.8 });
      await moveTo(page, page.getByLabel("New label name"));
      await pause(page, 1300);
    },
  }],

  "11-m05-rerun": ["admin", {
    setup: (page) => page.goto(`${BASE}/queue?filter=all&q=%23${demoTicket().number}`),
    run: async (page) => {
      await click(page, page.getByRole("button", { name: `Actions for #${demoTicket().number}` }));
      await cam(page, page.getByRole("menu").first(), { zoom: 2.0, pad: 40 });
      await moveTo(page, page.getByRole("menuitem", { name: "Re-run AI triage" }));
      await pause(page, 1300);
      await page.keyboard.press("Escape");
    },
  }],

  // The overview, not /admin/users: that page lists real account emails.
  "11-m07-admin": ["admin", {
    setup: (page) => page.goto(`${BASE}/admin`),
    run: async (page) => {
      await pause(page, 500);
      await moveTo(page, page.getByRole("heading", { name: "Overview" }));
      await pause(page, 1300);
    },
  }],

  "11-m08-settings": ["agent", {
    setup: async (page) => {
      await page.goto(`${BASE}/account`);
      // The first take's value is the original (a failed take may have left "dark").
      state.agentTheme ??= await page.getByLabel("Theme").inputValue();
      saveState();
    },
    run: async (page) => {
      const theme = page.getByLabel("Theme");
      await moveTo(page, theme);
      await theme.selectOption("dark");
      await click(page, page.getByRole("button", { name: "Save settings" }));
      await page.getByText("Settings saved.").waitFor();
      await pause(page, 1200);
    },
    // Put the agent's theme back (directly: the form's save can race the page closing).
    teardown: async () => {
      if (!state.agentTheme) return; // the scene never got as far as reading it
      const { error } = await db.from("profiles").update({ theme: state.agentTheme }).eq("email", process.env.TEST_AGENT_EMAIL.toLowerCase());
      if (error) throw new Error(`Theme not restored: ${error.message}`);
    },
  }],

  "11-m09-security": [null, {
    setup: (page) => page.goto(`${BASE}/login`),
    run: async (page) => {
      await cam(page, page.getByRole("button", { name: "Sign in" }).locator("xpath=ancestor::form[1]"), { zoom: 1.6 });
      await moveTo(page, page.getByRole("button", { name: "Sign in" }));
      await pause(page, 1400);
    },
  }],

  "11-m10-privacy": [null, {
    setup: (page) => page.goto(`${BASE}/privacy`),
    run: async (page) => {
      const title = page.getByRole("heading", { name: "Privacy policy", level: 1 });
      await cam(page, title.locator("xpath=.."), { zoom: 1.6 });
      await pause(page, 1300);
      const rights = page.getByRole("heading", { name: "Your rights and how to use them" });
      await scrollToLocator(page, rights, 1100);
      await cam(page, rights.locator("xpath=.."), { zoom: 1.7 });
      await pause(page, 1600);
    },
  }],
};

// ---- main --------------------------------------------------------------

const wanted = process.argv.slice(2);
const ids = Object.keys(SCENES).filter((id) => !wanted.length || wanted.some((w) => id.startsWith(w)));
if (!ids.length) throw new Error(`No scene matches ${wanted.join(", ")}`);
mkdirSync(BUILD, { recursive: true });
const browser = await chromium.launch();
try {
  for (const id of ids) {
    const [role, scene] = SCENES[id];
    await record(browser, id, role, scene);
  }
} finally {
  await browser.close();
}
