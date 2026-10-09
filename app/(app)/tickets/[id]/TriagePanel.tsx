import Link from "next/link";

import { rerunTriageAction } from "../actions";
import type { TriageResult } from "@/app/lib/db/triage";
import type { TriageState } from "@/app/lib/db/tickets";
import { formatCostUsd, formatRelativeTime } from "@/app/lib/format";
import { TriageReviewForm } from "./TriageReviewForm";
import { Badge } from "@/app/components/Badge";
import { priorityBadgeClasses } from "@/app/lib/badges";
import { secondaryButtonClass } from "@/app/lib/styles";
import { ticketHref, type QueueFilterKey } from "@/app/lib/queue-filters";

const STATUS_COPY: Record<string, string> = {
  pending: "Queued -- the assessment usually lands within a few seconds. Refresh to check.",
  processing: "Running...",
  failed: "Triage failed. You can re-run it.",
};

function reviewStatusLine(
  state: TriageState | null,
  triage: TriageResult | null,
  currentUserId: string
): string {
  if (!state?.reviewed_at) {
    return "Not reviewed yet. Confirm the AI's fields or correct them.";
  }
  const who =
    state.reviewed_by === currentUserId ? "you" : state.reviewed_by ? "a teammate" : "a former staff member";
  const line = `Reviewed by ${who} ${formatRelativeTime(state.reviewed_at)}.`;
  // A re-run after the review appends a new AI run but leaves the reviewed
  // fields alone, so say so rather than silently showing two answers.
  if (triage && state.reviewed_result_id !== triage.id) {
    return `${line} The AI has re-assessed since; its new suggestion is shown above and not applied.`;
  }
  return line;
}

export function TriagePanel({
  ticketId,
  triageStatus,
  triage,
  triageState,
  currentUserId,
  fromFilter,
}: {
  ticketId: string;
  triageStatus: string;
  triage: TriageResult | null;
  // The ticket's working values (what the queue sorts by) and who reviewed them.
  triageState: TriageState | null;
  currentUserId: string;
  // The queue tab the agent arrived from, carried onto the duplicate/related
  // links so hopping between tickets doesn't lose the way back.
  fromFilter: QueueFilterKey;
}) {
  const canRerun = triageStatus === "completed" || triageStatus === "failed";

  return (
    <section className="flex flex-col gap-3 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">AI triage</h2>
        <div className="flex items-center gap-2">
          <Badge label={triageStatus} colorClasses="bg-zinc-100 text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400" />
          {canRerun ? (
            <form action={rerunTriageAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <button type="submit" className={`${secondaryButtonClass} !px-3 !py-0.5 !text-xs`}>
                Re-run
              </button>
            </form>
          ) : null}
        </div>
      </div>

      {!triage ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          {STATUS_COPY[triageStatus] ?? "No assessment yet."}
        </p>
      ) : (
        <>
          <p className="text-sm text-zinc-800 dark:text-zinc-200">{triage.summary}</p>
          {triage.needs_human_review ? (
            <p className="text-xs font-medium text-amber-700 dark:text-amber-400">
              Low confidence -- review before relying on this.
            </p>
          ) : null}
          {triage.is_escalation_risk ? (
            <p className="text-xs font-medium text-red-700 dark:text-red-400">
              Escalation risk flagged.
            </p>
          ) : null}

          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-xs text-zinc-600 dark:text-zinc-400">
            <dt>Category</dt>
            <dd>{triage.category ?? "-"}</dd>
            <dt>Priority</dt>
            <dd>
              {triage.priority ? (
                <Badge label={triage.priority} colorClasses={priorityBadgeClasses(triage.priority)} />
              ) : (
                "-"
              )}
              {triage.priority_reason ? (
                <span className="block text-zinc-500 dark:text-zinc-500">{triage.priority_reason}</span>
              ) : null}
            </dd>
            <dt>Team</dt>
            <dd>{triage.team ?? "-"}</dd>
            <dt>Frustration</dt>
            <dd>{triage.frustration != null ? `${triage.frustration}/5` : "-"}</dd>
            <dt>Confidence</dt>
            <dd>{triage.confidence != null ? `${Math.round(triage.confidence * 100)}%` : "-"}</dd>
          </dl>

          {triage.duplicate_of ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Likely duplicate of{" "}
              <Link href={ticketHref(triage.duplicate_of, fromFilter)} className="underline">
                {triage.duplicate_of.slice(0, 8)}
              </Link>
            </p>
          ) : null}
          {triage.related_ticket_ids.length > 0 ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Related:{" "}
              {triage.related_ticket_ids.map((id) => (
                <Link key={id} href={ticketHref(id, fromFilter)} className="mr-2 underline">
                  {id.slice(0, 8)}
                </Link>
              ))}
            </p>
          ) : null}
          {triage.missing_info.length > 0 ? (
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              <p className="font-medium">Still needed from the customer:</p>
              <ul className="list-disc pl-4">
                {triage.missing_info.map((item, i) => (
                  <li key={i}>{item}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {triage.suggested_reply ? (
            <div className="text-xs text-zinc-600 dark:text-zinc-400">
              <p className="font-medium">
                Suggested reply (draft -- edit before sending; it was written with other
                tickets as context, so check every detail):
              </p>
              <p className="mt-1 whitespace-pre-wrap rounded-md bg-black/[.03] p-3 text-zinc-800 dark:bg-white/[.05] dark:text-zinc-200">
                {triage.suggested_reply}
              </p>
            </div>
          ) : null}
          <p className="text-[10px] text-zinc-400 dark:text-zinc-600">
            {triage.model} · prompt {triage.prompt_version}
            {triage.latency_ms != null ? ` · ${triage.latency_ms} ms` : ""}
            {triage.cost_usd != null ? ` · ${formatCostUsd(triage.cost_usd)}` : ""}
          </p>
        </>
      )}

      {triageStatus !== "processing" ? (
        <div className="flex flex-col gap-2 border-t border-black/[.08] pt-3 dark:border-white/[.145]">
          <h3 className="text-xs font-semibold text-black dark:text-zinc-50">Your review</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-500">
            {reviewStatusLine(triageState, triage, currentUserId)}
          </p>
          <TriageReviewForm
            // Remount when the AI run or the saved values change, so the
            // selects start from what's now true rather than stale state.
            key={`${triage?.id ?? "none"}:${triageState?.reviewed_at ?? "unreviewed"}`}
            ticketId={ticketId}
            resultId={triage?.id ?? null}
            ai={
              triage
                ? {
                    priority: triage.priority ?? "",
                    category: triage.category ?? "",
                    team: triage.team ?? "",
                  }
                : null
            }
            current={{
              priority: triageState?.priority ?? "",
              category: triageState?.category ?? "",
              team: triageState?.team ?? "",
            }}
          />
        </div>
      ) : null}
    </section>
  );
}
