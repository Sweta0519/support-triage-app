// Captures the homepage's product screenshots (SUP-49) from the running app
// with the demo data: desktop shots as the test admin at 2x, and phone shots
// as test customer B at an iPhone 16's size (393x852 at 3x). Saved as WebP
// in public/marketing/. The device frames themselves are drawn in CSS by
// app/welcome/DeviceFrames.tsx, not baked into the images.
//
//   npm run dev                                                   # or build + start
//   node --env-file=.env.local scripts/backdate-demo.mjs --apply  # fresh SLA states
//   node --env-file=.env.local scripts/capture-marketing.mjs
//
// So no test email shows on screen, the test agent and customer B get
// friendly display names for the run; their previous names are put back at
// the end, even if a shot fails.
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";
import sharp from "sharp";

const BASE = process.env.CAPTURE_BASE_URL ?? "http://localhost:3000";
const OUT = join(process.cwd(), "public", "marketing");
const DEMO_TICKET_SUBJECT = "Charged twice for Pro this month, need a refund";
const FRIENDLY = { TEST_AGENT_EMAIL: "Priya Patel", TEST_USER_B_EMAIL: "Alex Morgan" };

const db = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY, {
  db: { schema: "ticketing" },
  auth: { persistSession: false, autoRefreshToken: false },
});

async function signedIn(browser, emailVar, passwordVar, contextOptions) {
  const context = await browser.newContext({ colorScheme: "light", ...contextOptions });
  // The dev server's floating indicator isn't part of the product.
  await context.addInitScript(() => {
    const hide = () => {
      const style = document.createElement("style");
      style.textContent = "nextjs-portal { display: none !important; }";
      document.documentElement.appendChild(style);
    };
    if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", hide);
    else hide();
  });
  const page = await context.newPage();
  await page.goto(`${BASE}/login`);
  await page.getByPlaceholder("Email").fill(process.env[emailVar]);
  await page.getByPlaceholder("Password").fill(process.env[passwordVar]);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Not "Sign out": on a phone it sits in a closed menu.
  await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 60_000 });
  return page;
}

async function shot(page, name, { width }) {
  await page.waitForLoadState("networkidle");
  await page.waitForTimeout(600);
  const png = await page.screenshot();
  await sharp(png).resize({ width }).webp({ quality: 86 }).toFile(join(OUT, `${name}.webp`));
  console.log(`${name}.webp`);
}

async function ticketUrl(subject) {
  const { data, error } = await db.from("tickets").select("id").eq("subject", subject).order("created_at", { ascending: false }).limit(1).single();
  if (error) throw new Error(`No demo ticket "${subject}": record the demo video first (demo-video/record.mjs).`);
  return `${BASE}/tickets/${data.id}`;
}

mkdirSync(OUT, { recursive: true });
const previous = {};
for (const [emailVar, name] of Object.entries(FRIENDLY)) {
  const email = process.env[emailVar].toLowerCase();
  const { data } = await db.from("profiles").select("full_name").eq("email", email).single();
  previous[emailVar] = data.full_name;
  await db.from("profiles").update({ full_name: name }).eq("email", email);
}

const browser = await chromium.launch();
try {
  const demo = await ticketUrl(DEMO_TICKET_SUBJECT);

  // Desktop: 1440x900 at 2x, saved 2400 px wide.
  const desk = await signedIn(browser, "TEST_ADMIN_EMAIL", "TEST_ADMIN_PASSWORD", {
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
  });
  await desk.goto(`${BASE}/queue?filter=mine&status=assigned`);
  await shot(desk, "desktop-queue", { width: 2400 });
  // The demo incident (INC-30), opened from the staff banner.
  await desk.goto(`${BASE}/queue`);
  await desk.getByRole("region", { name: "Open incidents" }).getByRole("link", { name: /View INC-/ }).first().click();
  await desk.getByRole("heading", { name: "Update every affected customer" }).waitFor();
  await shot(desk, "desktop-incident", { width: 2400 });
  await desk.goto(`${BASE}/analytics`);
  await shot(desk, "desktop-analytics", { width: 2400 });

  // Phone: an iPhone 16's viewport at 3x, saved 1179 px wide (its real width).
  const phone = await signedIn(browser, "TEST_USER_B_EMAIL", "TEST_USER_B_PASSWORD", {
    viewport: { width: 393, height: 852 },
    deviceScaleFactor: 3,
    isMobile: true,
    hasTouch: true,
  });
  await phone.goto(demo);
  await shot(phone, "phone-ticket", { width: 1179 });
} finally {
  await browser.close();
  for (const [emailVar, name] of Object.entries(previous)) {
    await db.from("profiles").update({ full_name: name }).eq("email", process.env[emailVar].toLowerCase());
  }
  console.log("display names restored");
}
