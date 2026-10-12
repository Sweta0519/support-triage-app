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
  buildTriageRequests,
  MAX_BODY_CHARS,
  MAX_CANDIDATES,
  normalizeAssessment,
  normalizeReply,
  PROMPT_VERSION,
  type TriageAssessment,
  type TriageReply,
} from "@/app/lib/ai/triage-prompts";

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
    // link duplicates; the summary and reply come from a call that sees
    // only this ticket (SUP-31).
    const requests = buildTriageRequests(ticket, candidates);
    const [assessmentResult, replyResult] = await Promise.allSettled([
      completeJson<TriageAssessment>(requests.assessment),
      completeJson<TriageReply>(requests.reply),
    ]);
    if (assessmentResult.status === "rejected" || replyResult.status === "rejected") {
      // The run fails as a whole; log what the call that did succeed (and
      // the embedding) cost, since a failed run stores no result row.
      const spent =
        embeddingCostUsd +
        (assessmentResult.status === "fulfilled" ? assessmentResult.value.usage.cost_usd : 0) +
        (replyResult.status === "fulfilled" ? replyResult.value.usage.cost_usd : 0);
      console.error(`[triage] ticket ${ticket.id}: a model call failed after spending $${spent.toFixed(6)}`);
      throw assessmentResult.status === "rejected" ? assessmentResult.reason : (replyResult as PromiseRejectedResult).reason;
    }
    const assessment = assessmentResult.value;
    const reply = replyResult.value;

    const { output: assessed, needsHumanReview } = normalizeAssessment(assessment.data, new Set(candidateIds));
    const drafted = normalizeReply(reply.data, `${ticket.subject}\n${ticket.body}`);
    const output = { ...assessed, ...drafted };

    // A run that took so long a re-run took over must not record anything.
    if (!(await ownsTriageClaim(ticket.id, claimId))) {
      return;
    }
    await insertTriageResult({
      ticket_id: ticket.id,
      // Normally the same model; if OpenRouter routed the two calls
      // differently, both are named (and raw keeps each one's).
      model: assessment.model === reply.model ? assessment.model : `${assessment.model} + ${reply.model}`,
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
      raw: {
        assessment: { model: assessment.model, output: assessment.data },
        reply: { model: reply.model, output: reply.data },
      },
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
