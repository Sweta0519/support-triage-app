import "server-only";

import {
  completeJson,
  embed,
  isAiConfigured,
  EMBEDDING_MODEL,
} from "@/app/lib/ai/openrouter";
import {
  applyTriageToTicket,
  claimTicketForTriage,
  insertTriageEvent,
  insertTriageResult,
  markTriageFailed,
  ownsTriageClaim,
  matchTickets,
  resetTriageStatus,
  upsertTicketEmbedding,
} from "@/app/lib/db/triage";
import {
  ASSESSMENT_SYSTEM_PROMPT,
  buildAssessmentPrompt,
  buildAssessmentSchema,
  buildReplyPrompt,
  MAX_ASSESSMENT_TOKENS,
  MAX_BODY_CHARS,
  MAX_CANDIDATES,
  MAX_REPLY_TOKENS,
  normalizeAssessment,
  normalizeReply,
  PROMPT_VERSION,
  REPLY_SCHEMA,
  REPLY_SYSTEM_PROMPT,
  type TriageAssessment,
  type TriageReply,
} from "@/app/lib/ai/triage-prompts";

export { PROMPT_VERSION };

// Runs the full triage pipeline for one ticket. Safe to call more than
// once: the pending -> processing claim guarantees exactly one run does the
// work. Never throws to its caller -- a triage failure must never break the
// customer's submit or the agent's page -- it marks the ticket `failed` so a
// human can re-run it.
export async function runTriage(ticketId: string): Promise<void> {
  if (!isAiConfigured()) {
    return;
  }

  const claim = await claimTicketForTriage(ticketId);
  if (!claim) {
    return;
  }
  const { ticket, claimId } = claim;

  const startedAt = Date.now();
  try {
    const { vector: embedding, costUsd: embeddingCostUsd } = await embed(
      `${ticket.subject.slice(0, 200)}\n\n${ticket.body.slice(0, MAX_BODY_CHARS)}`
    );
    await upsertTicketEmbedding(ticket.id, embedding, EMBEDDING_MODEL);

    const candidates = await matchTickets(embedding, MAX_CANDIDATES, ticket.id);
    const candidateIds = candidates.map((c) => c.ticket_id);

    // Two calls, in parallel: the assessment sees the candidate tickets to
    // link duplicates; the reply sees only this ticket (SUP-31).
    const [assessment, reply] = await Promise.all([
      completeJson<TriageAssessment>({
        system: ASSESSMENT_SYSTEM_PROMPT,
        user: buildAssessmentPrompt(ticket, candidates),
        schemaName: "ticket_triage_assessment",
        schema: buildAssessmentSchema(candidateIds),
        maxTokens: MAX_ASSESSMENT_TOKENS,
      }),
      completeJson<TriageReply>({
        system: REPLY_SYSTEM_PROMPT,
        user: buildReplyPrompt(ticket),
        schemaName: "ticket_triage_reply",
        schema: REPLY_SCHEMA,
        maxTokens: MAX_REPLY_TOKENS,
      }),
    ]);

    const { output: assessed, needsHumanReview } = normalizeAssessment(assessment.data, new Set(candidateIds));
    const drafted = normalizeReply(reply.data, `${ticket.subject}\n${ticket.body}`);
    const output = { ...assessed, ...drafted };

    // A run that took so long a re-run took over must not record anything.
    if (!(await ownsTriageClaim(ticket.id, claimId))) {
      return;
    }
    await insertTriageResult({
      ticket_id: ticket.id,
      model: assessment.model,
      prompt_version: PROMPT_VERSION,
      summary: output.summary,
      category: output.category,
      priority: output.priority,
      priority_reason: output.priority_reason,
      team: output.team,
      frustration: output.frustration,
      is_escalation_risk: output.is_escalation_risk,
      duplicate_of: output.duplicate_of,
      related_ticket_ids: output.related_ticket_ids,
      suggested_reply: output.suggested_reply,
      missing_info: output.missing_info,
      confidence: output.confidence,
      needs_human_review: needsHumanReview,
      raw: { assessment: assessment.data, reply: reply.data },
      prompt_tokens: assessment.usage.prompt_tokens + reply.usage.prompt_tokens,
      completion_tokens: assessment.usage.completion_tokens + reply.usage.completion_tokens,
      latency_ms: Date.now() - startedAt,
      cost_usd: embeddingCostUsd + assessment.usage.cost_usd + reply.usage.cost_usd,
    });

    const applied = await applyTriageToTicket(ticket.id, claimId, {
      priority: output.priority,
      category: output.category,
      team: output.team,
    });
    if (applied) {
      await insertTriageEvent(ticket.id, "triage_completed", output.priority);
    }
  } catch (err) {
    console.error(`[triage] ticket ${ticket.id} failed:`, err instanceof Error ? err.message : err);
    try {
      if (await ownsTriageClaim(ticket.id, claimId)) {
        await markTriageFailed(ticket.id, claimId);
        await insertTriageEvent(ticket.id, "triage_failed", null);
      }
    } catch (inner) {
      console.error(`[triage] could not mark ticket ${ticket.id} failed:`, inner);
    }
  }
}

// Manual re-run from the staff UI. Resets to pending first so the atomic
// claim inside runTriage() can pick the ticket up again.
export async function rerunTriage(ticketId: string): Promise<void> {
  await resetTriageStatus(ticketId);
  await runTriage(ticketId);
}
