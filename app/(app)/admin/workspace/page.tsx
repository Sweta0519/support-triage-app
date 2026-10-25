import { requireAdmin } from "@/app/lib/auth/session";
import { getJoinToken, getWorkspaceName, listInvites } from "@/app/lib/db/workspaces";
import { SITE_URL } from "@/app/lib/site-url";
import { WorkspacePanel } from "./WorkspacePanel";

// Admin > Workspace (SUP-82): who can join. Customers sign up through the
// workspace's link; agents through a single-use invite made for their email.
export default async function AdminWorkspacePage() {
  const admin = await requireAdmin();
  const [name, joinToken, invites] = await Promise.all([getWorkspaceName(admin.workspace_id), getJoinToken(), listInvites()]);
  const now = new Date();

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-lg font-semibold text-black dark:text-zinc-50">{name}</h2>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Each account belongs to one workspace. People join this one through the links below.
        </p>
      </div>
      <WorkspacePanel joinUrl={`${SITE_URL}/join/${joinToken}`} invites={invites} now={now.getTime()} />
    </div>
  );
}
