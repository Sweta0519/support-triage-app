import Link from "next/link";

import { rerunTriageAction } from "../actions";
import type { TriageResult } from "@/app/lib/db/triage";

const STATUS_COPY: Record<string, string> = {
  pending: "Queued -- the assessment usually lands within a few seconds. Refresh to check.",
  processing: "Running...",
  failed: "Triage failed. You can re-run it.",
};

// Costs here are sub-cent (embedding + a short Haiku completion), so a
// plain toFixed(2) would show "$0.00" for every run -- not useful for
// judging whether triage is cheap. Show enough precision to see the number
// move.
function formatCostUsd(cost: number): string {
  if (cost <= 0) {
    return "$0.00";
  }
  if (cost < 0.01) {
    return `$${cost.toFixed(5)}`;
  }
  return `$${cost.toFixed(4)}`;
}

export function TriagePanel({
  ticketId,
  triageStatus,
  triage,
}: {
  ticketId: string;
  triageStatus: string;
  triage: TriageResult | null;
}) {
  const canRerun = triageStatus === "completed" || triageStatus === "failed";

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-black dark:text-zinc-50">AI triage</h2>
        <div className="flex items-center gap-2">
          <span className="rounded-full border border-black/[.08] px-2 py-0.5 text-xs text-zinc-600 dark:border-white/[.145] dark:text-zinc-400">
            {triageStatus}
          </span>
          {canRerun ? (
            <form action={rerunTriageAction}>
              <input type="hidden" name="ticketId" value={ticketId} />
              <button
                type="submit"
                className="rounded-full border border-black/[.08] px-3 py-0.5 text-xs font-medium transition-colors hover:bg-black/[.05] dark:border-white/[.145] dark:hover:bg-white/[.06]"
              >
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
              {triage.priority ?? "-"}
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
              <Link href={`/tickets/${triage.duplicate_of}`} className="underline">
                {triage.duplicate_of.slice(0, 8)}
              </Link>
            </p>
          ) : null}
          {triage.related_ticket_ids.length > 0 ? (
            <p className="text-xs text-zinc-600 dark:text-zinc-400">
              Related:{" "}
              {triage.related_ticket_ids.map((id) => (
                <Link key={id} href={`/tickets/${id}`} className="mr-2 underline">
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
    </section>
  );
}
