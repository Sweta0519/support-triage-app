import { requireAdmin } from "@/app/lib/auth/session";
import { listWorkload } from "@/app/lib/db/workload";
import { profileName } from "@/app/lib/people";
import { localTime, timezoneLabel, timezoneNames } from "@/app/lib/workload";
import { WorkloadRowForm, type ZoneGroup } from "./WorkloadRowForm";

// The timezone picker's options, grouped by region ("Europe", "America",
// ...), with UTC and other single-word zones under "Other".
function zoneGroups(): ZoneGroup[] {
  const groups = new Map<string, ZoneGroup["zones"]>();
  for (const zone of timezoneNames()) {
    const region = zone.includes("/") ? zone.split("/")[0] : "Other";
    const list = groups.get(region) ?? [];
    list.push({ value: zone, label: timezoneLabel(zone) });
    groups.set(region, list);
  }
  return [...groups.entries()]
    .sort(([a], [b]) => (a === "Other" ? -1 : b === "Other" ? 1 : a.localeCompare(b)))
    .map(([region, zones]) => ({ region, zones: zones.sort((a, b) => a.label.localeCompare(b.label)) }));
}

// Admin > Workload (SUP-77): every agent and admin, how many new cases
// they've been given today, their daily cap and their workplace timezone.
// The cap is enforced in the database on every way a ticket gets assigned.
export default async function AdminWorkloadPage() {
  const admin = await requireAdmin();
  const rows = await listWorkload();
  const groups = zoneGroups();
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">Workload</h2>
        <p className="max-w-3xl text-sm text-zinc-600 dark:text-zinc-400">
          A daily cap limits how many new cases someone can be given in a day, whether they claim them or an admin
          assigns them. Their day starts at midnight in their workplace timezone. Leave the cap blank for no limit.
        </p>
      </div>

      <div className="overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.145]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[.08] bg-black/[.02] text-left text-xs text-zinc-500 dark:border-white/[.145] dark:bg-white/[.03] dark:text-zinc-500">
              <th className="px-4 py-3 font-medium">Person</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">New cases today</th>
              <th className="px-4 py-3 font-medium">Daily cap</th>
              <th className="px-4 py-3 font-medium">Workplace timezone</th>
              <th className="px-4 py-3 font-medium">
                <span className="sr-only">Save</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <WorkloadRowForm
                key={row.id}
                row={row}
                name={profileName(row)}
                isSelf={row.id === admin.id}
                localTime={localTime(row.timezone, now)}
                zoneGroups={groups}
              />
            ))}
          </tbody>
        </table>
      </div>

      {rows.length === 0 ? (
        <p className="text-sm text-zinc-500 dark:text-zinc-500">No agents or admins yet.</p>
      ) : null}
    </div>
  );
}
