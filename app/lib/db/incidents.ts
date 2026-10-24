import "server-only";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";
import {
  INCIDENT_MIN_TICKETS,
  INCIDENT_SIMILARITY,
  INCIDENT_WINDOW_MINUTES,
  type IncidentStatus,
} from "@/app/lib/incidents";
import type { TicketStatus } from "@/app/lib/db/tickets";

// Incidents (SUP-42). Reads for pages go through the caller's RLS: staff
// see incidents, and an agent sees only the grouped tickets they can see.
// The service-role functions are for the background detection (no signed-in
// user) and for team-wide counts that must not depend on one agent's view;
// they return no ticket content.

export type Incident = {
  id: string;
  number: number;
  title: string;
  summary: string | null;
  draft_update: string | null;
  status: IncidentStatus;
  first_seen_at: string;
  opened_at: string;
  closed_at: string | null;
  update_posted_at: string | null;
};

const INCIDENT_COLUMNS = "id, number, title, summary, draft_update, status, first_seen_at, opened_at, closed_at, update_posted_at";

export type IncidentTicket = {
  id: string;
  number: number;
  subject: string;
  status: TicketStatus;
  created_at: string;
  assignee_id: string | null;
  added_at: string;
};

// --- Service role (background detection, team-wide counts) -------------

export async function detectIncident(
  ticketId: string
): Promise<{ incidentId: string; created: boolean; ticketCount: number; status: IncidentStatus } | null> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.rpc("detect_incident", {
    p_ticket_id: ticketId,
    p_threshold: INCIDENT_SIMILARITY,
    p_window_minutes: INCIDENT_WINDOW_MINUTES,
    p_min_tickets: INCIDENT_MIN_TICKETS,
  });
  if (error) throw new Error(error.message);
  const row = (data as { incident_id: string; created: boolean; ticket_count: number; status: IncidentStatus }[] | null)?.[0];
  return row ? { incidentId: row.incident_id, created: row.created, ticketCount: row.ticket_count, status: row.status } : null;
}

// The AI's own summaries of the grouped tickets (never their raw text), for
// writing the incident's title, summary and draft update.
export async function listIncidentSummaries(incidentId: string): Promise<{ summary: string; createdAt: string }[]> {
  const supabase = createServiceSupabaseClient();
  const { data: links, error } = await supabase
    .from("incident_tickets")
    .select("ticket:tickets(id, created_at)")
    .eq("incident_id", incidentId);
  if (error) throw new Error(error.message);
  const tickets = (links as unknown as { ticket: { id: string; created_at: string } | null }[]).flatMap((l) => (l.ticket ? [l.ticket] : []));
  if (tickets.length === 0) return [];
  // Two queries, not an embed: triage_results references tickets twice
  // (ticket_id and duplicate_of), so an embed would be ambiguous.
  const { data: results, error: e } = await supabase
    .from("triage_results")
    .select("ticket_id, summary, created_at")
    .in("ticket_id", tickets.map((t) => t.id))
    .order("created_at", { ascending: false });
  if (e) throw new Error(e.message);
  const latest = new Map<string, string>();
  for (const r of results as { ticket_id: string; summary: string }[]) if (!latest.has(r.ticket_id)) latest.set(r.ticket_id, r.summary);
  return tickets.flatMap((t) => (latest.has(t.id) ? [{ summary: latest.get(t.id)!, createdAt: t.created_at }] : []));
}

export async function setIncidentAiText(
  incidentId: string,
  text: { title: string; summary: string; draft_update: string }
): Promise<void> {
  const supabase = createServiceSupabaseClient();
  const { draft_update, ...rest } = text;
  const { error } = await supabase.from("incidents").update(rest).eq("id", incidentId).eq("status", "open");
  if (error) throw new Error(error.message);
  // The draft only until staff have posted: after that, draft_update holds
  // what customers were actually told, and a growing incident mustn't
  // overwrite that record.
  const { error: e } = await supabase
    .from("incidents")
    .update({ draft_update })
    .eq("id", incidentId)
    .eq("status", "open")
    .is("update_posted_at", null);
  if (e) throw new Error(e.message);
}

// Open incidents with their team-wide ticket counts, for the staff banner.
// Service role, so the caller's workspace is named here explicitly.
export async function listOpenIncidentsWithCounts(
  workspaceId: string,
  limit: number
): Promise<(Pick<Incident, "id" | "number" | "title" | "first_seen_at"> & { ticketCount: number })[]> {
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase
    .from("incidents")
    .select("id, number, title, first_seen_at, tickets:incident_tickets(count)")
    .eq("workspace_id", workspaceId)
    .eq("status", "open")
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return (data as unknown as (Pick<Incident, "id" | "number" | "title" | "first_seen_at"> & { tickets: { count: number }[] })[]).map(
    ({ tickets, ...rest }) => ({ ...rest, ticketCount: tickets[0]?.count ?? 0 })
  );
}

// Team-wide ticket counts per incident (an agent's own view may show fewer).
export async function countIncidentTickets(incidentIds: string[]): Promise<Map<string, number>> {
  const counts = new Map<string, number>();
  if (incidentIds.length === 0) return counts;
  const supabase = createServiceSupabaseClient();
  const { data, error } = await supabase.from("incident_tickets").select("incident_id").in("incident_id", incidentIds);
  if (error) throw new Error(error.message);
  for (const row of data as { incident_id: string }[]) counts.set(row.incident_id, (counts.get(row.incident_id) ?? 0) + 1);
  return counts;
}

// --- The caller's own RLS (pages and actions) ---------------------------

export async function listIncidents(limit = 50): Promise<Incident[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("incidents")
    .select(INCIDENT_COLUMNS)
    .order("opened_at", { ascending: false })
    .limit(limit);
  if (error) throw new Error(error.message);
  return data as Incident[];
}

export async function getIncident(id: string): Promise<Incident | null> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("incidents").select(INCIDENT_COLUMNS).eq("id", id).maybeSingle();
  if (error) throw new Error(error.message);
  return data as Incident | null;
}

// The grouped tickets the caller can see, newest first.
export async function listIncidentTickets(incidentId: string): Promise<IncidentTicket[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("incident_tickets")
    .select("added_at, ticket:tickets(id, number, subject, status, created_at, assignee_id)")
    .eq("incident_id", incidentId);
  if (error) throw new Error(error.message);
  type Row = { added_at: string; ticket: Omit<IncidentTicket, "added_at"> | null };
  return (data as unknown as Row[])
    .flatMap((row) => (row.ticket ? [{ ...row.ticket, added_at: row.added_at }] : []))
    .sort((a, b) => b.created_at.localeCompare(a.created_at));
}

// ticket id -> its open incident, for the markers on cards and tickets.
export async function openIncidentsForTickets(
  ticketIds: string[]
): Promise<Map<string, Pick<Incident, "id" | "number" | "title">>> {
  const result = new Map<string, Pick<Incident, "id" | "number" | "title">>();
  if (ticketIds.length === 0) return result;
  const supabase = await createServerSupabaseClient();
  // Chunked (ids go in the URL, see listLabelsForTickets), in parallel.
  const chunks: string[][] = [];
  for (let i = 0; i < ticketIds.length; i += 50) chunks.push(ticketIds.slice(i, i + 50));
  const responses = await Promise.all(
    chunks.map((ids) => supabase.from("incident_tickets").select("ticket_id, incident:incidents(id, number, title, status)").in("ticket_id", ids))
  );
  for (const { data, error } of responses) {
    if (error) throw new Error(error.message);
    type Row = { ticket_id: string; incident: (Pick<Incident, "id" | "number" | "title"> & { status: string }) | null };
    for (const row of data as unknown as Row[]) {
      if (row.incident?.status === "open") {
        const { id, number, title } = row.incident;
        result.set(row.ticket_id, { id, number, title });
      }
    }
  }
  return result;
}

// Closes an open incident (resolved or dismissed). false if it wasn't open.
export async function closeIncident(id: string, status: "resolved" | "dismissed", userId: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("incidents")
    .update({ status, closed_at: new Date().toISOString(), closed_by: userId })
    .eq("id", id)
    .eq("status", "open")
    .select("id");
  if (error) throw new Error(error.message);
  return (data ?? []).length > 0;
}

export async function recordIncidentUpdatePosted(id: string, userId: string, text: string): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase
    .from("incidents")
    .update({ draft_update: text, update_posted_at: new Date().toISOString(), update_posted_by: userId })
    .eq("id", id)
    .eq("status", "open");
  if (error) throw new Error(error.message);
}

// For Analytics (admins): incidents opened in the last `days` days.
export async function listIncidentsSince(days: number): Promise<Pick<Incident, "status" | "first_seen_at" | "opened_at">[]> {
  const since = new Date(Date.now() - days * 24 * 60 * 60_000).toISOString();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("incidents")
    .select("status, first_seen_at, opened_at")
    .gte("opened_at", since)
    .limit(1000);
  if (error) throw new Error(error.message);
  return data as Pick<Incident, "status" | "first_seen_at" | "opened_at">[];
}

// Of these tickets, the ones that already carry this exact public reply from
// this author -- so a retried or repeated post never sends it twice.
export async function ticketsWithReply(ticketIds: string[], authorId: string, body: string): Promise<Set<string>> {
  if (ticketIds.length === 0) return new Set();
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("ticket_comments")
    .select("ticket_id")
    .in("ticket_id", ticketIds)
    .eq("author_id", authorId)
    .eq("is_internal", false)
    .eq("body", body);
  if (error) throw new Error(error.message);
  return new Set((data as { ticket_id: string }[]).map((r) => r.ticket_id));
}
