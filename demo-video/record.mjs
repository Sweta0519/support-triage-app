// Records the demo video's scenes (SUP-44) by driving the app on
// localhost:3000 with the project's test accounts, the same way the
// Playwright suite does. Each scene is captured as JPEG frames through the
// Chrome DevTools screencast (sharper than Playwright's built-in video) into
// demo-video/build/frames/<scene>/, with a timestamp per frame for build.mjs.
//
//   npm run build && npm run start          # in another terminal
//   node --env-file=.env.local demo-video/record.mjs              # every scene
//   node --env-file=.env.local demo-video/record.mjs 03-triage    # some scenes
//
// It changes live data, like a person giving the demo would: it files one
// new ticket as test customer B, reviews, claims, answers, moves, flags,
// labels, shares and resolves it, and adds one note for the test agent.
// Nothing else is changed; the theme switch in the montage is put back.
import { mkdirSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = "http://localhost:3000";
const ROOT = dirname(fileURLToPath(import.meta.url));
const BUILD = join(ROOT, "build");
const STATE = join(BUILD, "state.json");
const VIEWPORT = { width: 1536, height: 864 }; // x1.25 = 1920x1080 frames

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

const state = existsSync(STATE) ? JSON.parse(readFileSync(STATE, "utf8")) : {};
const saveState = () => writeFileSync(STATE, JSON.stringify(state, null, 2));

// ---- recording helpers -------------------------------------------------

const pause = (page, ms) => page.waitForTimeout(ms);

// A visible cursor (headless Chrome draws none) that keeps its place across
// navigations and shrinks on click.
function cursorScript() {
  const install = () => {
    if (document.getElementById("__demo_cursor")) return;
    const c = document.createElement("div");
    c.id = "__demo_cursor";
    c.innerHTML =
      '<svg width="22" height="22" viewBox="0 0 24 24"><path d="M4 2l16 9.5-7 1.5-3.5 7z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    Object.assign(c.style, {
      position: "fixed", left: "0", top: "0", zIndex: "2147483647", pointerEvents: "none",
      transition: "scale 120ms", transformOrigin: "4px 2px",
    });
    const saved = JSON.parse(sessionStorage.getItem("__demo_cursor") || "[768,432]");
    c.style.transform = `translate(${saved[0] - 4}px, ${saved[1] - 2}px)`;
    document.documentElement.appendChild(c);
    document.addEventListener("mousemove", (e) => {
      c.style.transform = `translate(${e.clientX - 4}px, ${e.clientY - 2}px)`;
      sessionStorage.setItem("__demo_cursor", JSON.stringify([e.clientX, e.clientY]));
    }, true);
    document.addEventListener("mousedown", () => (c.style.scale = "0.8"), true);
    document.addEventListener("mouseup", () => (c.style.scale = "1"), true);
  };
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", install);
  else install();
}

async function moveTo(page, locator) {
  await locator.scrollIntoViewIfNeeded();
  const box = await locator.boundingBox();
  if (!box) return;
  await page.mouse.move(box.x + Math.min(box.width / 2, 60), box.y + box.height / 2, { steps: 22 });
  await pause(page, 250);
}

async function click(page, locator) {
  await moveTo(page, locator);
  await locator.click();
  await pause(page, 400);
}

async function type(page, locator, text, delay = 24) {
  await click(page, locator);
  await locator.pressSequentially(text, { delay });
  await pause(page, 300);
}

// Eased scroll of whatever scrolls the page, so it reads on video.
async function scrollTo(page, target, ms = 1400) {
  await page.evaluate(
    async ({ target, ms }) => {
      const el = [...document.querySelectorAll("main, body *")].find(
        (n) => n.scrollHeight > n.clientHeight + 20 && /(auto|scroll)/.test(getComputedStyle(n).overflowY),
      ) || document.scrollingElement;
      const from = el.scrollTop;
      const to = typeof target === "number" ? target : from + document.querySelector(target).getBoundingClientRect().top - 90;
      const t0 = performance.now();
      await new Promise((done) => {
        const step = (now) => {
          const k = Math.min(1, (now - t0) / ms);
          el.scrollTop = from + (to - from) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2);
          k < 1 ? requestAnimationFrame(step) : done();
        };
        requestAnimationFrame(step);
      });
    },
    { target, ms },
  );
  await pause(page, 300);
}

// Scrolls so the element is near the top of the view.
async function scrollToLocator(page, locator, ms) {
  const handle = await locator.elementHandle();
  await page.evaluate((el) => el.setAttribute("data-demo-scroll", "1"), handle);
  await scrollTo(page, '[data-demo-scroll="1"]', ms);
  await page.evaluate((el) => el.removeAttribute("data-demo-scroll"), handle);
}

async function signIn(browser, role) {
  const file = join(BUILD, "auth", `${role}.json`);
  if (existsSync(file)) return file;
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

// Runs setup unrecorded, then records run() as frames.
async function record(browser, id, role, { setup, run }) {
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 1.25,
    storageState: role ? await signIn(browser, role) : undefined,
    colorScheme: "light",
  });
  await context.addInitScript(cursorScript);
  const page = await context.newPage();
  page.setDefaultTimeout(30_000);
  if (setup) await setup(page);
  await pause(page, 500);

  const dir = join(BUILD, "frames", id);
  rmSync(dir, { recursive: true, force: true });
  mkdirSync(dir, { recursive: true });
  const cdp = await context.newCDPSession(page);
  const frames = [];
  cdp.on("Page.screencastFrame", async ({ data, metadata, sessionId }) => {
    const file = `${String(frames.length).padStart(5, "0")}.jpg`;
    writeFileSync(join(dir, file), Buffer.from(data, "base64"));
    frames.push({ file, t: metadata.timestamp });
    await cdp.send("Page.screencastFrameAck", { sessionId }).catch(() => {});
  });
  await cdp.send("Page.startScreencast", { format: "jpeg", quality: 92, maxWidth: 1920, maxHeight: 1080 });
  // Nudge one frame out even if the page is still.
  await page.mouse.move(VIEWPORT.width / 2, VIEWPORT.height / 2);
  const started = Date.now() / 1000;
  await run(page);
  await pause(page, 900);
  const ended = Date.now() / 1000;
  await cdp.send("Page.stopScreencast");
  writeFileSync(join(dir, "frames.json"), JSON.stringify({ started, ended, frames }, null, 1));
  console.log(`${id}: ${frames.length} frames, ${(ended - started).toFixed(1)} s`);
  await context.close();
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

// ---- scenes ------------------------------------------------------------

const SCENES = {
  "02-customer": ["customer", {
    setup: (page) => page.goto(`${BASE}/tickets/new`),
    run: async (page) => {
      await type(page, page.getByPlaceholder("Subject"), DEMO_TICKET.subject, 30);
      await type(page, page.getByPlaceholder("Describe what's going on..."), DEMO_TICKET.body, 12);
      await click(page, page.getByRole("button", { name: "Submit ticket" }));
      await page.getByRole("heading", { name: DEMO_TICKET.subject }).waitFor();
      state.ticketUrl = page.url();
      const { data } = await db.from("tickets").select("number").eq("id", page.url().split("/").pop()).single();
      state.ticketNumber = data.number;
      saveState();
      await pause(page, 1800);
    },
  }],

  "03-triage": ["agent", {
    setup: async (page) => {
      await page.goto(state.ticketUrl);
      await waitForTriage(page);
    },
    run: async (page) => {
      const panel = panelOf(page);
      await pause(page, 800);
      await scrollToLocator(page, panel, 1200);
      for (const term of ["Category", "Priority", "Team", "Frustration"]) {
        await moveTo(page, panel.getByRole("term").filter({ hasText: new RegExp(`^${term}$`) }).first());
        await pause(page, 900);
      }
      const related = panel.getByText(/related|duplicate/i).first();
      if (await related.isVisible().catch(() => false)) {
        await scrollToLocator(page, related, 900);
        await moveTo(page, related);
        await pause(page, 1200);
      }
      const missing = panel.getByText(/still needed/i).first();
      if (await missing.isVisible().catch(() => false)) {
        await scrollToLocator(page, missing, 900);
        await pause(page, 1500);
      }
      await scrollToLocator(page, panel.getByText(/^Suggested reply/).first(), 1000);
      await pause(page, 2200);
      await moveTo(page, panel.getByText(/\$0\.\d+/).first());
      await pause(page, 1500);
    },
  }],

  "04-review": ["agent", {
    setup: (page) => page.goto(state.ticketUrl),
    run: async (page) => {
      const panel = panelOf(page);
      await scrollToLocator(page, panel.getByText("Your review"), 1000);
      const priority = panel.getByLabel("Priority");
      const current = await priority.inputValue();
      await moveTo(page, priority);
      await priority.selectOption(current === "urgent" ? "high" : "urgent");
      await pause(page, 700);
      await click(page, panel.getByRole("button", { name: /Save correction|Save triage|Confirm AI triage/ }));
      await panel.getByRole("status").waitFor();
      await pause(page, 1500);
      await scrollTo(page, 0, 900);
      await click(page, page.getByRole("button", { name: "Claim ticket" }));
      await page.getByText("Assigned to you").first().waitFor();
      await pause(page, 900);
      const use = page.getByRole("button", { name: /Use suggested reply/ });
      await scrollToLocator(page, use, 1000);
      await click(page, use);
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: "Add comment" }));
      await pause(page, 2000);
    },
  }],

  "05-queue": ["agent", {
    setup: (page) => page.goto(`${BASE}/queue?filter=all`),
    run: async (page) => {
      await pause(page, 1200);
      await moveTo(page, page.getByText("SLA at risk").first());
      await pause(page, 900);
      await moveTo(page, page.getByText("SLA breached").first());
      await pause(page, 900);
      await moveTo(page, page.getByText(/At risk · reply in/).first());
      await pause(page, 1300);
      await moveTo(page, page.getByText(/Overdue/).first());
      await pause(page, 1000);
      await click(page, page.getByRole("navigation", { name: "Assignment" }).getByRole("link", { name: /^Mine/ }));
      await pause(page, 1500);
      await click(page, page.getByRole("navigation", { name: "Assignment" }).getByRole("link", { name: /^All/ }));
      await type(page, page.getByPlaceholder("Search tickets"), "refund", 70);
      await page.keyboard.press("Enter");
      await pause(page, 2200);
    },
  }],

  "06-board": ["agent", {
    setup: (page) => page.goto(`${BASE}/board`),
    run: async (page) => {
      const n = state.ticketNumber;
      const card = page.locator("article", { hasText: DEMO_TICKET.subject }).first();
      const target = page.getByRole("region", { name: /^In progress, \d+ tickets?$/ });
      await moveTo(page, card);
      await pause(page, 600);
      const tb = await target.boundingBox();
      await page.mouse.move(tb.x + tb.width / 2, tb.y + 140, { steps: 30 });
      const dt = await page.evaluateHandle(() => new DataTransfer());
      await card.dispatchEvent("dragstart", { dataTransfer: dt });
      await target.dispatchEvent("dragover", { dataTransfer: dt });
      await target.dispatchEvent("drop", { dataTransfer: dt });
      await card.dispatchEvent("dragend", { dataTransfer: dt });
      await page.getByRole("status").filter({ hasText: `Moved #${n} to In progress.` }).waitFor();
      await pause(page, 1800);
      await page.goto(`${BASE}/queue?filter=all&q=%23${n}`);
      await pause(page, 900);
      await click(page, page.getByRole("button", { name: `Actions for #${n}` }));
      await pause(page, 700);
      await click(page, page.getByRole("menuitem", { name: "Flag to follow up" }));
      await page.getByRole("status").filter({ hasText: `Flagged #${n}` }).waitFor();
      await pause(page, 1200);
      await moveTo(page, cardOf(page, n).getByText(DEMO_TICKET.subject).first());
      await page.keyboard.press("l");
      const picker = page.getByRole("group", { name: "Add or remove labels" });
      await picker.waitFor();
      await pause(page, 700);
      await click(page, picker.getByRole("button").filter({ hasNotText: /Create/ }).first());
      await pause(page, 900);
      await page.keyboard.press("Escape");
      await pause(page, 1400);
    },
  }],

  "07-learning": ["admin", {
    setup: async (page) => page.goto(await ticketUrl(4190)),
    run: async (page) => {
      const summary = page.getByText(/✦ Used \d+ past corrections? as examples/);
      await scrollToLocator(page, panelOf(page), 1000);
      await moveTo(page, summary);
      await pause(page, 900);
      await summary.click();
      await pause(page, 1500);
      await moveTo(page, page.getByText(/→/).first());
      await pause(page, 1500);
      const by = page.getByText(/· by /).first();
      if (await by.isVisible().catch(() => false)) {
        await moveTo(page, by);
        await pause(page, 1200);
      }
      await moveTo(page, page.getByRole("button", { name: "Don't learn from this" }).first());
      await pause(page, 1800);
    },
  }],

  "08-incident": ["admin", {
    setup: (page) => page.goto(`${BASE}/queue`),
    run: async (page) => {
      const banner = page.getByRole("region", { name: "Open incidents" });
      await moveTo(page, banner);
      await pause(page, 1000);
      await click(page, banner.getByRole("link", { name: /View INC-/ }));
      await page.getByRole("heading", { name: "Update every affected customer" }).waitFor();
      await pause(page, 1500);
      await scrollTo(page, 380, 1600);
      await pause(page, 1200);
      await scrollToLocator(page, page.getByRole("heading", { name: "Update every affected customer" }), 1200);
      await moveTo(page, page.getByLabel("Update text"));
      await pause(page, 1500);
      await click(page, page.getByRole("button", { name: "Post update…" }));
      await pause(page, 1300);
      await moveTo(page, page.getByRole("button", { name: /^Post to \d+ tickets?$/ }));
      await pause(page, 1200);
      await click(page, page.getByRole("button", { name: "Cancel" }));
      await pause(page, 900);
    },
  }],

  // Two shots: the note being written, then Sage asked from the demo ticket
  // (as the admin: the test agent's notes and Sage history hold test fixtures).
  "09a-note": ["admin", {
    setup: async (page) => {
      // Re-recording: drop the demo note made by an earlier take.
      const { data: admin } = await db.from("profiles").select("id").eq("email", process.env.TEST_ADMIN_EMAIL.toLowerCase()).single();
      await db.from("notes").delete().eq("owner_id", admin.id).eq("title", DEMO_NOTE.title);
      await page.goto(`${BASE}/notes/new`);
    },
    run: async (page) => {
      await type(page, page.getByPlaceholder("Title"), DEMO_NOTE.title, 40);
      await type(page, page.getByPlaceholder("Write the note..."), DEMO_NOTE.body, 10);
      await moveTo(page, page.getByRole("button", { name: "Save note" }));
      await page.getByRole("button", { name: "Save note" }).click();
      await page.waitForURL((u) => !u.pathname.endsWith("/new"), { timeout: 60_000 });
    },
  }],

  "09b-sage": ["admin", {
    setup: (page) => page.goto(state.ticketUrl),
    run: async (page) => {
      await pause(page, 600);
      await click(page, page.getByRole("button", { name: "Open Sage" }));
      // Show it as a fresh chat: hide this account's earlier (test) turns.
      await page.getByTestId("assistant-widget-message").first().waitFor().catch(() => {});
      await page.evaluate(() => {
        for (const m of document.querySelectorAll('[data-testid="assistant-widget-message"]')) m.style.display = "none";
      });
      await pause(page, 600);
      await type(page, page.getByPlaceholder("Message Sage..."), "What do my notes say about refunding a duplicate charge?", 30);
      const answers = page.getByTestId("assistant-widget-message").filter({ hasText: /Refund policy/ });
      const before = await answers.count();
      await click(page, page.getByRole("button", { name: "Send" }));
      await answers.nth(before).waitFor({ timeout: 120_000 });
      await pause(page, 500);
      // Start the chat at this question, so earlier (test) turns are off screen.
      const question = page.getByTestId("assistant-widget-message").filter({ hasText: "refunding a duplicate charge" }).last();
      await question.evaluate((el) => {
        let box = el.parentElement;
        while (box && box.scrollHeight <= box.clientHeight + 4) box = box.parentElement;
        if (box) box.scrollTo({ top: el.offsetTop - box.offsetTop - 12, behavior: "smooth" });
      });
      await pause(page, 5500);
    },
  }],

  "10-analytics": ["admin", {
    setup: (page) => page.goto(`${BASE}/analytics`),
    run: async (page) => {
      await pause(page, 1200);
      for (const h of ["First-response SLA by priority", "Triage quality", "Is the AI learning?", "Team performance", "Customer sentiment"]) {
        await scrollToLocator(page, page.getByRole("heading", { name: h }), 1300);
        await pause(page, 1500);
      }
    },
  }],

  // ---- montage (scene 11): short shots, one caption each ----

  "11-m01-on-behalf": ["agent", {
    setup: (page) => page.goto(`${BASE}/tickets/new`),
    run: async (page) => {
      await type(page, page.getByLabel("Customer email"), "customer@example.com", 25);
      await type(page, page.getByLabel("Subject"), "Called in: can't export invoices", 18);
      await moveTo(page, page.getByRole("button", { name: "Create ticket" }));
      await pause(page, 600);
    },
  }],

  "11-m02-csat": ["customer", {
    setup: async (page) => {
      // The agent resolves the demo ticket first (unrecorded).
      const agent = await page.context().browser().newContext({ storageState: await signIn(page.context().browser(), "agent") });
      const ap = await agent.newPage();
      await ap.goto(state.ticketUrl);
      const resolve = ap.getByRole("button", { name: "Move to Resolved" });
      if (await resolve.isVisible().catch(() => false)) {
        await resolve.click();
        await ap.getByRole("button", { name: "Move to Resolved" }).waitFor({ state: "detached" }).catch(() => {});
      }
      await agent.close();
      await page.goto(state.ticketUrl);
    },
    run: async (page) => {
      const heading = page.getByRole("heading", { name: /How did we do\?|Your rating/ });
      await scrollToLocator(page, heading, 700);
      await moveTo(page, page.getByLabel("5 stars", { exact: false }).first());
      await page.getByLabel(/^5 stars/).check({ force: true });
      await pause(page, 400);
      await click(page, page.getByRole("button", { name: /Send rating|Update rating/ }));
      await pause(page, 900);
    },
  }],

  "11-m03-share": ["agent", {
    setup: (page) => page.goto(state.ticketUrl),
    run: async (page) => {
      const publish = page.getByRole("button", { name: "Publish public status page" });
      if (await publish.isVisible().catch(() => false)) {
        await scrollToLocator(page, publish, 600);
        await click(page, publish);
      }
      const url = await page.locator("code").filter({ hasText: "/s/" }).first().innerText();
      await pause(page, 500);
      await page.goto(url.startsWith("http") ? url : `${BASE}${url}`);
      await pause(page, 1300);
    },
  }],

  "11-m04-labels": ["admin", {
    setup: (page) => page.goto(`${BASE}/labels`),
    run: async (page) => {
      await pause(page, 500);
      await moveTo(page, page.getByLabel("New label name"));
      await pause(page, 1300);
    },
  }],

  "11-m05-rerun": ["agent", {
    setup: (page) => page.goto(`${BASE}/queue?filter=all&q=%23${state.ticketNumber}`),
    run: async (page) => {
      await click(page, page.getByRole("button", { name: `Actions for #${state.ticketNumber}` }));
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
      await pause(page, 1400);
    },
  }],

  "11-m08-settings": ["agent", {
    setup: async (page) => {
      await page.goto(`${BASE}/account`);
      state.agentTheme = await page.getByLabel("Theme").inputValue();
      saveState();
    },
    run: async (page) => {
      const theme = page.getByLabel("Theme");
      await moveTo(page, theme);
      await theme.selectOption("dark");
      await click(page, page.getByRole("button", { name: "Save settings" }));
      await page.getByText("Settings saved.").waitFor();
      await pause(page, 1200);
      // Put the agent's theme back (still recording, but the shot is cut before this).
      await theme.selectOption(state.agentTheme);
      await page.getByRole("button", { name: "Save settings" }).click();
      await page.getByText("Settings saved.").waitFor();
    },
  }],

  "11-m09-security": [null, {
    setup: (page) => page.goto(`${BASE}/login`),
    run: async (page) => {
      await moveTo(page, page.getByRole("button", { name: "Sign in" }));
      await pause(page, 1500);
    },
  }],

  "11-m10-tests": [null, {
    setup: (page) => page.goto(`file://${join(ROOT, "..", "playwright-report", "index.html")}`),
    run: async (page) => {
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
    if (id !== "02-customer" && !state.ticketUrl && !/^(07|08|10|11-m04|11-m07|11-m09|11-m10)/.test(id)) {
      throw new Error("Record 02-customer first: later scenes use its ticket.");
    }
    const [role, scene] = SCENES[id];
    await record(browser, id, role, scene);
  }
} finally {
  await browser.close();
}
