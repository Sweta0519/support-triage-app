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

// The AI's draft update goes to every customer in the group, so nothing
// that could belong to one of them may survive: email addresses, links and
// long numbers (order, invoice or account references) are removed. Staff
// still read and edit it before posting.
export function sanitizeIncidentUpdate(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[removed]")
    .replace(/\b(?:https?:\/\/|www\.)\S+/gi, "[removed]")
    .replace(/\b[A-Z]{0,5}-?\d[\d-]{3,}\b/g, "[removed]")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, INCIDENT_UPDATE_MAX_LENGTH);
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
