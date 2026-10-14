// Learning from corrections (SUP-43): the tuning and the pure helpers. No
// server-only import, so client components and tests use it too.

import { fieldLabel } from "@/app/lib/triage-fields";

// A past correction guides a new ticket only if their embeddings are at
// least this similar: the same *kind* of problem. Measured with the app's
// embedding model (docs/learning.md): three SSO login failures worded
// differently scored 0.54-0.63 with each other, a password-reset problem
// (also "login") at most 0.36, unrelated tickets 0.11-0.27. A wrong
// example costs more than a missing one, so this errs strict.
export const LEARNING_SIMILARITY = 0.45;
export const LEARNING_MAX_EXAMPLES = 3;

export type TriageValues = { priority: string | null; category: string | null; team: string | null };

export type CorrectionExample = {
  ticket_id: string;
  summary: string;
  ai: TriageValues;
  corrected: TriageValues;
};

const FIELDS = ["priority", "category", "team"] as const;

// "priority High → Urgent, team Support → Engineering": only what staff
// changed.
export function describeCorrection(ai: TriageValues, corrected: TriageValues): string {
  return FIELDS.filter((f) => ai[f] !== corrected[f])
    .map((f) => `${f} ${fieldLabel(ai[f] ?? "none")} → ${fieldLabel(corrected[f] ?? "none")}`)
    .join(", ");
}

// For Analytics: how often staff accepted the AI's triage as it was, per
// ISO week (Monday, UTC) of the review, oldest first, and per category the
// staff settled on. Manual triage (no AI run) isn't counted.
export type AcceptanceRow = {
  reviewed_at: string;
  ai: TriageValues;
  corrected: TriageValues;
};

export function weekStart(iso: string): string {
  const d = new Date(iso);
  const day = (d.getUTCDay() + 6) % 7; // Monday = 0
  const monday = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - day));
  return monday.toISOString().slice(0, 10);
}

export function acceptanceByWeek(rows: AcceptanceRow[], weeks: number, now: Date): { week: string; accepted: number; reviewed: number }[] {
  const out = new Map<string, { accepted: number; reviewed: number }>();
  const thisWeek = new Date(`${weekStart(now.toISOString())}T00:00:00Z`).getTime();
  for (let i = weeks - 1; i >= 0; i--) {
    out.set(new Date(thisWeek - i * 7 * 24 * 60 * 60_000).toISOString().slice(0, 10), { accepted: 0, reviewed: 0 });
  }
  for (const row of rows) {
    const bucket = out.get(weekStart(row.reviewed_at));
    if (!bucket) continue;
    bucket.reviewed += 1;
    if (FIELDS.every((f) => row.ai[f] === row.corrected[f])) bucket.accepted += 1;
  }
  return [...out.entries()].map(([week, v]) => ({ week, ...v }));
}

export function acceptanceByCategory(rows: AcceptanceRow[]): { category: string; accepted: number; reviewed: number }[] {
  const out = new Map<string, { accepted: number; reviewed: number }>();
  for (const row of rows) {
    const category = row.corrected.category ?? "none";
    const bucket = out.get(category) ?? { accepted: 0, reviewed: 0 };
    bucket.reviewed += 1;
    if (FIELDS.every((f) => row.ai[f] === row.corrected[f])) bucket.accepted += 1;
    out.set(category, bucket);
  }
  return [...out.entries()].map(([category, v]) => ({ category, ...v })).sort((a, b) => b.reviewed - a.reviewed);
}
