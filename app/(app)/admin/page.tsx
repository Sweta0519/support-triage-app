import { requireAdmin } from "@/app/lib/auth/session";
import { getAdminStats, MAX_ROWS } from "@/app/lib/db/admin";
import { formatCostUsd } from "@/app/lib/format";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="text-xs font-medium text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="mt-1 text-2xl font-semibold text-black dark:text-zinc-50">{value}</p>
    </div>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  return (
    <div className="rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="mb-3 text-xs font-medium text-zinc-500 dark:text-zinc-500">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-400">No data.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {entries.map(([key, count]) => (
            <li key={key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-sm">
                <span className="capitalize text-zinc-700 dark:text-zinc-300">{key}</span>
                <span className="font-medium text-black dark:text-zinc-50">{count}</span>
              </div>
              <div className="h-1 overflow-hidden rounded-full bg-black/[.05] dark:bg-white/[.08]">
                <div
                  className="h-full rounded-full bg-indigo-500"
                  style={{ width: total > 0 ? `${(count / total) * 100}%` : "0%" }}
                />
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const stats = await getAdminStats();

  return (
    <div className="flex flex-col gap-6">
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">Overview</h2>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <Stat label="Tickets" value={stats.total} />
        <Stat label="Open & unassigned" value={stats.unassignedOpen} />
        <Stat
          label="Avg first response"
          value={
            stats.avgFirstResponseMinutes != null ? `${stats.avgFirstResponseMinutes} min` : "-"
          }
        />
        <Stat
          label="Avg triage latency"
          value={stats.triage.avgLatencyMs != null ? `${stats.triage.avgLatencyMs} ms` : "-"}
        />
        <Stat label="AI spend (recent)" value={formatCostUsd(stats.triage.totalCostUsd, "coarse")} />
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Breakdown title="By status" data={stats.byStatus} />
        <Breakdown title="By priority" data={stats.byPriority} />
        <Breakdown
          title="AI triage"
          data={{
            completed: stats.triage.completed,
            pending: stats.triage.pending,
            processing: stats.triage.processing,
            failed: stats.triage.failed,
            "needs human review": stats.triage.needsHumanReview,
          }}
        />
      </div>

      {stats.sampled ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-500">
          Figures are computed over the most recent {MAX_ROWS.toLocaleString()} rows.
        </p>
      ) : null}
    </div>
  );
}
