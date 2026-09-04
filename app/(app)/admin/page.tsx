import { requireAdmin } from "@/app/lib/auth/session";
import { getAdminStats, MAX_ROWS } from "@/app/lib/db/admin";

function Stat({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="text-xs text-zinc-500 dark:text-zinc-500">{label}</p>
      <p className="text-2xl font-semibold text-black dark:text-zinc-50">{value}</p>
    </div>
  );
}

function Breakdown({ title, data }: { title: string; data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  return (
    <div className="rounded-lg border border-black/[.08] p-4 dark:border-white/[.145]">
      <p className="mb-2 text-xs font-medium text-zinc-500 dark:text-zinc-500">{title}</p>
      {entries.length === 0 ? (
        <p className="text-xs text-zinc-400">No data.</p>
      ) : (
        <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1 text-sm">
          {entries.map(([key, count]) => (
            <div key={key} className="contents">
              <dt className="text-zinc-700 dark:text-zinc-300">{key}</dt>
              <dd className="text-right font-medium text-black dark:text-zinc-50">{count}</dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  );
}

export default async function AdminOverviewPage() {
  await requireAdmin();
  const stats = await getAdminStats();

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Overview</h1>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
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
