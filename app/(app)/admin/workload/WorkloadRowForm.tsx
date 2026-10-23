"use client";

import { setWorkloadAction } from "../actions";
import { Avatar } from "@/app/components/Avatar";
import { useSafeActionState } from "@/app/components/useSafeActionState";
import { PRESENCE_DOT, PRESENCES } from "@/app/lib/presence";
import type { WorkloadRow } from "@/app/lib/db/workload";
import { DAILY_CAP_MAX } from "@/app/lib/workload";

const fieldClass =
  "rounded-lg border border-black/[.08] bg-white px-2 py-1 text-xs text-black dark:border-white/[.145] dark:bg-black dark:text-zinc-50";

export type ZoneGroup = { region: string; zones: { value: string; label: string }[] };

// One person's row on Admin > Workload (SUP-77). The fields sit in table
// cells, so they join the row's form through the form attribute.
export function WorkloadRowForm({
  row,
  name,
  isSelf,
  localTime,
  zoneGroups,
}: {
  row: WorkloadRow;
  name: string;
  isSelf: boolean;
  // The time now in their timezone, as the page rendered it.
  localTime: string;
  zoneGroups: ZoneGroup[];
}) {
  const [state, action, pending, formRef] = useSafeActionState(setWorkloadAction, undefined, (error) => ({
    status: "error" as const,
    error,
  }));
  const formId = `workload-${row.id}`;
  const atCap = row.daily_case_cap !== null && row.assigned_today >= row.daily_case_cap;

  return (
    <tr className="border-b border-black/[.06] align-top last:border-0 dark:border-white/[.08]">
      <td className="px-4 py-3 text-black dark:text-zinc-50">
        <div className="flex items-center gap-2.5">
          <Avatar id={row.id} name={name} avatarPath={row.avatar_path} size={28} />
          <div className="flex min-w-0 flex-col">
            <span>
              {name}
              {isSelf ? <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">(you)</span> : null}
            </span>
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              {row.full_name ? `${row.email} · ` : null}
              <span className="capitalize">{row.role}</span>
            </span>
          </div>
        </div>
      </td>
      <td className="px-4 py-3">
        <span className="flex items-center gap-1.5 text-xs text-zinc-600 dark:text-zinc-400">
          <span aria-hidden="true" className={`h-2 w-2 rounded-full ${PRESENCE_DOT[row.presence]}`} />
          {PRESENCES[row.presence]}
        </span>
      </td>
      <td className="px-4 py-3 text-xs text-zinc-600 dark:text-zinc-400">
        <span className={atCap ? "font-medium text-black dark:text-zinc-50" : undefined}>
          {row.daily_case_cap === null ? row.assigned_today : `${row.assigned_today} of ${row.daily_case_cap}`}
        </span>
        {atCap ? <span className="block text-[11px] text-zinc-500 dark:text-zinc-500">At today&apos;s cap</span> : null}
      </td>
      <td className="px-4 py-3">
        <input
          form={formId}
          name="cap"
          type="number"
          inputMode="numeric"
          min={0}
          max={DAILY_CAP_MAX}
          step={1}
          defaultValue={row.daily_case_cap ?? ""}
          placeholder="No cap"
          aria-label={`Daily cap for ${name}`}
          className={`${fieldClass} w-24`}
        />
      </td>
      <td className="px-4 py-3">
        <select
          form={formId}
          name="timezone"
          defaultValue={row.timezone}
          aria-label={`Timezone for ${name}`}
          className={`${fieldClass} max-w-56`}
        >
          {zoneGroups.map((group) => (
            <optgroup key={group.region} label={group.region}>
              {group.zones.map((z) => (
                <option key={z.value} value={z.value}>
                  {z.label}
                </option>
              ))}
            </optgroup>
          ))}
        </select>
        <span className="mt-1 block text-[11px] text-zinc-500 dark:text-zinc-500">{localTime} there now</span>
      </td>
      <td className="px-4 py-3">
        <form id={formId} ref={formRef} action={action} className="flex flex-col items-start gap-1">
          <input type="hidden" name="userId" value={row.id} />
          <button
            type="submit"
            disabled={pending}
            className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.05] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
          >
            {pending ? "Saving…" : "Save"}
          </button>
          {state?.status === "saved" ? (
            <span role="status" className="text-[11px] text-zinc-500 dark:text-zinc-500">
              Saved.
            </span>
          ) : state?.status === "error" ? (
            <span role="alert" className="max-w-48 text-[11px] text-red-600 dark:text-red-400">
              {state.error}
            </span>
          ) : null}
        </form>
      </td>
    </tr>
  );
}
