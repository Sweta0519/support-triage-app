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
// It writes the live database with the service-role key, so it only ever
// touches the ticket numbers listed below. Before --apply writes anything,
// every timestamp it will change is saved to .demo-backups/ (git-ignored),
// and --restore puts them back.
//
// Each ticket's timestamps are moved by a piecewise-linear map between
// anchors (created, first reply, resolved, now). Replies, history, triage
// runs, reviews, ratings, labels and flags all keep their order on the
// ticket, and nothing lands in the future. It can be re-run: the anchors
// are read from the current state each time.
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

// Per table: the column(s) identifying a row, and the timestamps to move.
const TABLES = [
  ["ticket_comments", ["id"], ["created_at"]],
  ["ticket_events", ["id"], ["created_at"]],
  ["triage_results", ["id"], ["created_at"]],
  ["ticket_triage_state", ["ticket_id"], ["claimed_at", "reviewed_at"]],
  ["ticket_ratings", ["ticket_id"], ["created_at"]],
  ["ticket_flags", ["ticket_id", "user_id"], ["created_at"]],
  ["ticket_labels", ["ticket_id", "label_id"], ["added_at"]],
  ["ticket_embeddings", ["ticket_id"], ["created_at"]],
];
const TICKET_TIMES = ["created_at", "first_response_at", "resolved_at", "closed_at"];

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error("Needs NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY: run with --env-file=.env.local");
  process.exit(1);
}
const db = createClient(url, key, { db: { schema: "ticketing" }, auth: { persistSession: false } });

const now = Date.now();
const ms = (s) => (s ? Date.parse(s) : null);
const iso = (n) => (n == null ? null : new Date(n).toISOString());

// Piecewise-linear map through [old, new] anchor pairs.
function mapper(anchors) {
  const a = anchors.filter(([o, n]) => o != null && n != null).sort((x, y) => x[0] - y[0]);
  return (t) => {
    if (t == null) return null;
    if (t <= a[0][0]) return a[0][1] - (a[0][0] - t);
    for (let i = 1; i < a.length; i++) {
      const [o0, n0] = a[i - 1];
      const [o1, n1] = a[i];
      if (t <= o1) return o1 === o0 ? n1 : n0 + ((t - o0) / (o1 - o0)) * (n1 - n0);
    }
    const [oL, nL] = a[a.length - 1];
    return Math.min(now, nL + (t - oL));
  };
}

function match(query, cols, row) {
  return cols.reduce((q, c) => q.eq(c, row[c]), query);
}

async function update(table, idCols, row, values) {
  const { error } = await match(db.from(table).update(values), idCols, row);
  if (error) throw new Error(`${table}: ${error.message}`);
}

async function restore(file) {
  const backup = JSON.parse(readFileSync(file, "utf8"));
  for (const t of backup.tickets) {
    await update("tickets", ["id"], t, Object.fromEntries(TICKET_TIMES.map((c) => [c, t[c]])));
  }
  for (const [table, idCols, cols] of TABLES) {
    for (const row of backup.related[table] ?? []) {
      await update(table, idCols, row, Object.fromEntries(cols.map((c) => [c, row[c]])));
    }
  }
  console.log(`Restored ${backup.tickets.length} tickets from ${file} (taken ${backup.taken_at}).`);
}

async function backdate(apply) {
  const numbers = [...Object.keys(RESOLVED), ...Object.keys(OPEN)].map(Number);
  const { data: tickets, error } = await db.from("tickets").select(["id", "number", "status", ...TICKET_TIMES].join(", ")).in("number", numbers);
  if (error) throw new Error(error.message);
  const backup = { taken_at: iso(now), tickets, related: {} };
  const plan = [];

  for (const t of tickets.sort((a, b) => a.number - b.number)) {
    const [C, R, X] = [ms(t.created_at), ms(t.first_response_at), ms(t.resolved_at)];
    let anchors;
    if (RESOLVED[t.number]) {
      if (t.status !== "resolved" && t.status !== "closed") {
        console.warn(`#${t.number} is ${t.status}, not resolved: skipped`);
        continue;
      }
      const [ago, reply, resolve] = RESOLVED[t.number];
      const c = now - ago;
      // After the resolution (the rating): a couple of hours later.
      anchors = [[C, c], [R, R == null ? null : c + reply], [X, c + resolve], [now, c + resolve + 2 * H]];
    } else {
      anchors = [[C, now - OPEN[t.number]], [now, now]];
    }
    const f = mapper(anchors);
    const ticket = Object.fromEntries(TICKET_TIMES.map((c) => [c, iso(f(ms(t[c])))]));
    const related = [];
    for (const [table, idCols, cols] of TABLES) {
      const { data: rows, error: e } = await db.from(table).select([...new Set([...idCols, ...cols])].join(", ")).eq("ticket_id", t.id);
      if (e) throw new Error(`${table}: ${e.message}`);
      (backup.related[table] ??= []).push(...rows);
      for (const row of rows) {
        const values = Object.fromEntries(cols.filter((c) => row[c] != null).map((c) => [c, iso(f(ms(row[c])))]));
        if (Object.keys(values).length) related.push({ table, idCols, row, values });
      }
    }
    plan.push({ t, ticket, related });
    const ago = (s) => (s ? `${((now - Date.parse(s)) / H).toFixed(1)}h ago` : "-");
    console.log(
      `#${t.number} ${t.status.padEnd(11)} created ${ago(ticket.created_at)} | reply ${ago(ticket.first_response_at)} | resolved ${ago(ticket.resolved_at)} | ${related.length} related rows`
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
  for (const p of plan) {
    await update("tickets", ["id"], p.t, p.ticket);
    for (const r of p.related) await update(r.table, r.idCols, r.row, r.values);
  }
  console.log(`Applied to ${plan.length} tickets.`);
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
