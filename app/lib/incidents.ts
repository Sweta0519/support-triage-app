// Incident detection (SUP-42): the tuning and the pure helpers. No
// server-only import, so client components and tests use it too.

// A burst: at least INCIDENT_MIN_TICKETS open tickets filed within
// INCIDENT_WINDOW_MINUTES whose embeddings are at least INCIDENT_SIMILARITY
// similar (cosine). Chosen by the owner (3 in 60 minutes); the similarity
// was calibrated on real tickets and realistic outage reports
// (docs/incidents.md): the same outage worded differently scored 0.50-0.66,
// different problems at most 0.47.
export const INCIDENT_MIN_TICKETS = 3;
export const INCIDENT_WINDOW_MINUTES = 60;
export const INCIDENT_SIMILARITY = 0.5;

export const INCIDENT_UPDATE_MAX_LENGTH = 2000;

export type IncidentStatus = "open" | "resolved" | "dismissed";

export function incidentLabel(number: number): string {
  return `INC-${number}`;
}

export const INCIDENT_STATUS_LABEL: Record<IncidentStatus, string> = {
  open: "Open",
  resolved: "Resolved",
  dismissed: "Dismissed",
};

// The AI's incident text -- above all the draft update, which goes to
// every customer in the group -- must not carry anything that could belong
// to one of them. Removed: email addresses, links, phone numbers (any
// spacing or brackets), reference codes like ORD-55120 or INV 20431,
// money amounts, and any other run of 5+ digits. Kept: years, dates and
// times ("2026", "2026-10-13", "14:00"), which describe the incident, not a
// customer. Staff still read and edit the draft before posting.
const SCRUB: RegExp[] = [
  /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, // email
  /\b(?:https?:\/\/|www\.)\S+/gi, // link
  /(?:\+\d{1,3}[\s.-]?)?(?:\(\d{2,4}\)[\s.-]?)?\d{2,4}(?:[\s.-]\d{2,4}){2,}/g, // phone (3+ groups)
  /\(\d{2,4}\)[\s.-]?\d{2,4}[\s.-]?\d{2,4}/g, // phone with an area code in brackets
  /\b[A-Z]{2,6}[\s#:-]?\d{3,}\b/g, // reference code
  /[$€£]\s?\d[\d.,]*|\b\d[\d.,]*\s?(?:USD|EUR|GBP)\b/gi, // money
  /\b\d{5,}\b/g, // any other long number
];

export function sanitizeIncidentText(text: string, maxLength = INCIDENT_UPDATE_MAX_LENGTH): string {
  // Dates and times are set aside first so the number rules can't eat them.
  const kept: string[] = [];
  let out = text.replace(/\b\d{4}-\d{2}-\d{2}\b|\b\d{1,2}:\d{2}\b/g, (m) => `\u0000${kept.push(m) - 1}\u0000`);
  for (const pattern of SCRUB) out = out.replace(pattern, "[removed]");
  out = out.replace(/\u0000(\d+)\u0000/g, (_, i) => kept[Number(i)]);
  return out.replace(/[ \t]+\n/g, "\n").trim().slice(0, maxLength);
}

// For Analytics: incidents in a period, by outcome, and the median time from
// the first report to detection (opened_at - first_seen_at).
export function summarizeIncidents(rows: { status: IncidentStatus; first_seen_at: string; opened_at: string }[]): {
  total: number;
  open: number;
  resolved: number;
  dismissed: number;
  medianDetectionMs: number | null;
} {
  const lags = rows
    .map((r) => Date.parse(r.opened_at) - Date.parse(r.first_seen_at))
    .filter((n) => Number.isFinite(n) && n >= 0)
    .sort((a, b) => a - b);
  const mid = Math.floor(lags.length / 2);
  return {
    total: rows.length,
    open: rows.filter((r) => r.status === "open").length,
    resolved: rows.filter((r) => r.status === "resolved").length,
    dismissed: rows.filter((r) => r.status === "dismissed").length,
    medianDetectionMs: lags.length === 0 ? null : lags.length % 2 ? lags[mid] : Math.round((lags[mid - 1] + lags[mid]) / 2),
  };
}
