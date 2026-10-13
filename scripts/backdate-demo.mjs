// Re-dates the demo tickets (#1472-#1483) into a realistic spread, so the
// queue shows a mix of SLA states and resolved tickets look like past work.
// An ops script for preparing a demo, not part of the app. Run it shortly
// before a demo: the ages are relative to "now", so "at risk" tickets go
// overdue within the hour.
//
//   node --env-file=.env.local scripts/backdate-demo.mjs            # dry run
//   node --env-file=.env.local scripts/backdate-demo.mjs --apply    # write
//   node --env-file=.env.local scripts/backdate-demo.mjs --restore .demo-backups/<file>.json
//
// It writes the live database with the service-role key (read from the env
// file; like the Playwright tests, it runs locally and is never part of
// app/), and only ever touches the ticket numbers listed below. Before
// --apply writes anything, every timestamp it will change is saved to
// .demo-backups/ (git-ignored), and --restore puts them back -- refusing a
// file that names any other ticket.
//
// How: each ticket's timestamps are moved by a piecewise-linear map between
// anchors (created, first reply, resolved, now). Replies, history, triage
// runs, reviews, ratings, labels, flags and share links keep their order on
// the ticket, and nothing lands in the future. It can be re-run: the
// anchors are read from the current state each time.
//
// Known limits:
// - updated_at isn't moved: a trigger stamps now() on every update. Rows
//   are written oldest-new-date first, so anything sorted by updated_at
//   (e.g. ratings) still comes out in the backdated order.
// - Ticket numbers stop matching creation order: open tickets need recent
//   dates for live SLA states, resolved ones older dates to look like past
//   work, and the numbers are fixed. Fine for a demo.
// - Updates are one request each, not a transaction. If a run fails
//   part-way, it prints the --restore command for the backup it saved.
// - --restore is meant for right after an --apply. It never writes a null
//   over a value set since (e.g. a first reply sent during the demo), but
//   other times changed since are put back to the backup's.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const H = 3_600_000;
const D = 24 * H;
const M = 60_000;

// Resolved tickets: [created this long ago, first reply after, resolved after].
const RESOLVED = {
  1477: [12 * D, 2 * H, 1 * D],
  1479: [9 * D, 3 * H, 2 * D],
  1472: [6 * D, 1 * H, 5 * H],
  1483: [4 * D, 2 * H, 6 * H],
  // Urgent (1h target), replied late: SLA "missed", matching its 2-star review.
  1476: [3 * D, 5 * H, 2 * D],
};
// Open tickets: their age now. The SLA targets (app/lib/sla.ts) are urgent 1h,
// high 4h, normal 8h, low 24h; "at risk" in the last quarter of the window.
const OPEN = {
  1482: 50 * M, // urgent -> at risk
  1480: 1 * H, // high -> on track
  1473: 3.5 * H, // high -> at risk
  1478: 3 * H, // normal -> on track
  1475: 5 * H, // low -> on track
  1481: 26 * H, // high -> breached
  1474: 2 * D, // normal -> breached
};
const DEMO_NUMBERS = new Set([...Object.keys(RESOLVED), ...Object.keys(OPEN)].map(Number));

// Per table: the key column(s) of a row, and the timestamps to move. Every
// row is also read with its ticket_id, which ties it to a demo ticket.
// keep(row): rows to leave alone -- a triage run still in progress keeps its
// claimed_at, or backdating it would make the run look stalled (and let
// another run take its claim, and count toward the "AI triage is failing"
// banner).
const TABLES = [
  { table: "ticket_comments", keys: ["id"], cols: ["created_at"] },
  { table: "ticket_events", keys: ["id"], cols: ["created_at"] },
  { table: "triage_results", keys: ["id"], cols: ["created_at"] },
  {
    table: "ticket_triage_state",
    keys: ["ticket_id"],
    cols: ["claimed_at", "reviewed_at"],
    extra: ["triage_status"],
    keep: (row) => row.triage_status === "processing",
  },
  { table: "ticket_ratings", keys: ["ticket_id"], cols: ["created_at"] },
  { table: "ticket_flags", keys: ["ticket_id", "user_id"], cols: ["created_at"] },
  { table: "ticket_labels", keys: ["ticket_id", "label_id"], cols: ["added_at"] },
  { table: "ticket_embeddings", keys: ["ticket_id"], cols: ["created_at"] },
  // Only created_at: expires_at stays, so a live share link isn't cut short.
  { table: "shared_ticket_summaries", keys: ["id"], cols: ["created_at"] },
];
const TICKET_TIMES = ["created_at", "first_response_at", "resolved_at", "closed_at"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: run with --env-file=.env.local");
  process.exit(1);
}
const db = createClient(url, key, { db: { schema: "ticketing" }, auth: { persistSession: false } });

const ms = (s) => (s ? Date.parse(s) : null);
const iso = (n) => (n == null ? null : new Date(n).toISOString());

// "Now" by the database's clock (the Date header of a request to it), not
// this machine's: the stored timestamps come from the database's now(), and
// a laptop a few minutes off would shift the tight "at risk" windows.
async function serverNow() {
  const res = await fetch(`${url}/rest/v1/`, { headers: { apikey: key } });
  const date = Date.parse(res.headers.get("date") ?? "");
  return Number.isNaN(date) ? Date.now() : date;
}

// Piecewise-linear map through [old, new] anchor pairs, never past `now`.
// The new times must rise with the old ones, or events would come out in a
// different order.
function mapper(anchors, now, label) {
  const a = anchors.filter(([o, n]) => o != null && n != null).sort((x, y) => x[0] - y[0]);
  for (let i = 1; i < a.length; i++) {
    if (a[i][1] < a[i - 1][1]) throw new Error(`${label}: the target dates would reorder its events; check RESOLVED/OPEN`);
  }
  return (t) => {
    if (t == null) return null;
    if (t <= a[0][0]) return a[0][1] - (a[0][0] - t);
    for (let i = 1; i < a.length; i++) {
      const [o0, n0] = a[i - 1];
      const [o1, n1] = a[i];
      if (t <= o1) return Math.min(now, o1 === o0 ? n1 : n0 + ((t - o0) / (o1 - o0)) * (n1 - n0));
    }
    const [oL, nL] = a[a.length - 1];
    return Math.min(now, nL + (t - oL));
  };
}

// Every key column must have a value: an update must never match by a
// missing key.
function match(query, keys, row) {
  return keys.reduce((q, c) => {
    if (row[c] == null) throw new Error(`refusing an update with no ${c}`);
    return q.eq(c, row[c]);
  }, query);
}

async function update(table, keys, row, values) {
  const { error } = await match(db.from(table).update(values), keys, row);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function restore(file) {
  const backup = JSON.parse(readFileSync(file, "utf8"));
  // Only ever the demo tickets, whatever the file says.
  const strays = backup.tickets.filter((t) => !DEMO_NUMBERS.has(t.number)).map((t) => t.number);
  if (strays.length) throw new Error(`backup has tickets outside the demo set: ${strays.join(", ")}`);
  const ids = new Set(backup.tickets.map((t) => t.id));
  for (const rows of Object.values(backup.related)) {
    if (rows.some((r) => !ids.has(r.ticket_id))) throw new Error("backup has related rows for tickets it doesn't list");
  }
  const { data: current, error } = await db
    .from("tickets")
    .select(["id", ...TICKET_TIMES].join(", "))
    .in("id", [...ids]);
  if (error) throw new Error(error.message);
  for (const t of backup.tickets) {
    const now = current.find((c) => c.id === t.id);
    if (!now) continue;
    // Never a null over a value set since the backup (e.g. a first reply).
    const values = Object.fromEntries(TICKET_TIMES.filter((c) => t[c] != null || now[c] == null).map((c) => [c, t[c]]));
    await update("tickets", ["id"], t, values);
  }
  for (const { table, keys, cols } of TABLES) {
    for (const row of backup.related[table] ?? []) {
      await update(table, keys, row, Object.fromEntries(cols.map((c) => [c, row[c]])));
    }
  }
  console.log(`Restored ${backup.tickets.length} tickets from ${file} (taken ${backup.taken_at}).`);
}

async function backdate(apply) {
  const now = await serverNow();
  const numbers = [...DEMO_NUMBERS];
  const { data: found, error } = await db.from("tickets").select(["id", "number", "status", ...TICKET_TIMES].join(", ")).in("number", numbers);
  if (error) throw new Error(error.message);
  const missing = numbers.filter((n) => !found.some((t) => t.number === n));
  if (missing.length) console.warn(`Not found, skipped: #${missing.join(", #")}`);
  const tickets = found
    .filter((t) => {
      const skip = RESOLVED[t.number] && t.status !== "resolved" && t.status !== "closed";
      if (skip) console.warn(`#${t.number} is ${t.status}, not resolved: skipped`);
      return !skip;
    })
    .sort((a, b) => a.number - b.number);
  const ids = tickets.map((t) => t.id);

  // One query per table for all the tickets' rows.
  const related = {};
  for (const { table, keys, cols, extra = [] } of TABLES) {
    const select = [...new Set(["ticket_id", ...keys, ...cols, ...extra])].join(", ");
    const { data, error: e } = await db.from(table).select(select).in("ticket_id", ids);
    if (e) throw new Error(`${table}: ${e.message}`);
    related[table] = data;
  }

  const backup = { taken_at: iso(now), tickets, related: {} };
  const writes = [];
  const ago = (s) => (s ? `${((now - Date.parse(s)) / H).toFixed(1)}h ago` : "-");
  for (const t of tickets) {
    const [C, R, X] = [ms(t.created_at), ms(t.first_response_at), ms(t.resolved_at)];
    let anchors;
    if (RESOLVED[t.number]) {
      const [age, reply, resolve] = RESOLVED[t.number];
      const c = now - age;
      // A reply that came after the resolution isn't an anchor: it's mapped
      // with the rest of the after-resolution stretch, keeping the order.
      const replyAnchor = R != null && (X == null || R <= X) ? [R, c + reply] : [null, null];
      // After the resolution (the rating): a couple of hours later.
      anchors = [[C, c], replyAnchor, [X, c + resolve], [now, Math.min(now, c + resolve + 2 * H)]];
    } else {
      anchors = [[C, now - OPEN[t.number]], [now, now]];
    }
    const f = mapper(anchors, now, `#${t.number}`);
    const ticket = Object.fromEntries(TICKET_TIMES.map((c) => [c, iso(f(ms(t[c])))]));
    writes.push({ at: Date.parse(ticket.created_at), run: () => update("tickets", ["id"], t, ticket) });
    let count = 0;
    for (const { table, keys, cols, keep } of TABLES) {
      for (const row of related[table].filter((r) => r.ticket_id === t.id)) {
        if (keep?.(row)) continue;
        const values = Object.fromEntries(cols.filter((c) => row[c] != null).map((c) => [c, iso(f(ms(row[c])))]));
        if (!Object.keys(values).length) continue;
        (backup.related[table] ??= []).push(row);
        count++;
        writes.push({
          at: Math.max(...Object.values(values).map((v) => Date.parse(v))),
          run: () => update(table, keys, row, values),
        });
      }
    }
    console.log(
      `#${t.number} ${t.status.padEnd(11)} created ${ago(ticket.created_at)} | reply ${ago(ticket.first_response_at)} | resolved ${ago(ticket.resolved_at)} | ${count} related rows`
    );
  }

  if (!apply) {
    console.log("\nDry run. Re-run with --apply to write (a backup is saved first).");
    return;
  }
  mkdirSync(".demo-backups", { recursive: true });
  const file = `.demo-backups/backdate-${new Date(now).toISOString().replace(/[:.]/g, "-")}.json`;
  writeFileSync(file, JSON.stringify(backup, null, 1));
  console.log(`\nBackup: ${file}  (undo: --restore ${file})`);
  // Oldest new date first, so the updated_at stamps the trigger adds come
  // out in the same order as the backdated dates.
  writes.sort((a, b) => a.at - b.at);
  try {
    for (const w of writes) await w.run();
  } catch (err) {
    throw new Error(`${err.message}\nPartly applied. Undo with: node --env-file=.env.local scripts/backdate-demo.mjs --restore ${file}`);
  }
  console.log(`Applied to ${tickets.length} tickets.`);
}

const args = process.argv.slice(2);
const restoreAt = args.indexOf("--restore");
try {
  if (restoreAt !== -1) {
    if (!args[restoreAt + 1]) throw new Error("--restore needs the backup file");
    await restore(args[restoreAt + 1]);
  } else {
    await backdate(args.includes("--apply"));
  }
} catch (err) {
  console.error("ERROR", err.message);
  process.exit(1);
}
