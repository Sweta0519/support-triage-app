import { requireAdmin } from "@/app/lib/auth/session";
import { APP_ROLES, listProfiles } from "@/app/lib/db/profiles";
import { setRoleAction } from "../actions";
import { Badge } from "@/app/components/Badge";
import { roleBadgeClasses } from "@/app/lib/badges";

const ERROR_MESSAGES: Record<string, string> = {
  self: "You can't change your own role.",
  "last-admin": "You can't demote the last remaining admin.",
  missing: "That user no longer exists.",
  invalid: "That role isn't valid.",
  failed: "The role change failed. Please try again.",
};

export default async function AdminUsersPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string; saved?: string }>;
}) {
  const admin = await requireAdmin();
  const params = await searchParams;
  const profiles = await listProfiles();

  return (
    <div className="flex flex-col gap-4">
      <h2 className="text-sm font-semibold text-zinc-500 dark:text-zinc-500">Users</h2>

      {params.error ? (
        <p className="rounded-lg border border-red-300 bg-red-50 px-4 py-2 text-sm text-red-700 dark:border-red-900 dark:bg-red-950/30 dark:text-red-300">
          {ERROR_MESSAGES[params.error] ?? ERROR_MESSAGES.failed}
        </p>
      ) : null}
      {params.saved ? (
        <p className="rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-2 text-sm text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/30 dark:text-emerald-300">
          Role updated.
        </p>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-black/[.08] dark:border-white/[.145]">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-black/[.08] bg-black/[.02] text-left text-xs text-zinc-500 dark:border-white/[.145] dark:bg-white/[.03] dark:text-zinc-500">
              <th className="px-4 py-3 font-medium">Email</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Change</th>
            </tr>
          </thead>
          <tbody>
            {profiles.map((p) => {
              const isSelf = p.id === admin.id;
              return (
                <tr key={p.id} className="border-b border-black/[.06] last:border-0 dark:border-white/[.08]">
                  <td className="px-4 py-3 text-black dark:text-zinc-50">
                    {p.email}
                    {isSelf ? (
                      <span className="ml-2 text-xs text-zinc-500 dark:text-zinc-500">(you)</span>
                    ) : null}
                  </td>
                  <td className="px-4 py-3">
                    <Badge label={p.role} colorClasses={roleBadgeClasses(p.role)} />
                  </td>
                  <td className="px-4 py-3">
                    <form action={setRoleAction} className="flex items-center gap-2">
                      <input type="hidden" name="userId" value={p.id} />
                      <select
                        name="role"
                        defaultValue={p.role}
                        disabled={isSelf}
                        aria-label={`Role for ${p.email}`}
                        className="rounded-lg border border-black/[.08] bg-white px-2 py-1 text-xs text-black disabled:opacity-50 dark:border-white/[.145] dark:bg-black dark:text-zinc-50"
                      >
                        {APP_ROLES.map((role) => (
                          <option key={role} value={role}>
                            {role}
                          </option>
                        ))}
                      </select>
                      <button
                        type="submit"
                        disabled={isSelf}
                        className="rounded-full border border-black/[.08] px-3 py-1 text-xs font-medium transition-colors hover:bg-black/[.05] disabled:opacity-50 dark:border-white/[.145] dark:hover:bg-white/[.06]"
                      >
                        Save
                      </button>
                    </form>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-500">
        Demoting an agent to customer unassigns their tickets so they return to the shared queue.
      </p>
    </div>
  );
}
