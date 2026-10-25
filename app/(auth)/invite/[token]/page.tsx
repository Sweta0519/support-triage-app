import { SignupForm } from "../../signup/SignupForm";
import { WorkspaceLinkNotice } from "@/app/components/WorkspaceLinkNotice";
import { getUser } from "@/app/lib/auth/session";
import { findOpenInvite, workspaceLinkLookupAllowed } from "@/app/lib/db/workspaces";

// An agent invite (SUP-82): single-use, for one email, expires after 7 days.
// Signing up here with that email joins the workspace as an agent; the
// database checks the invite again and uses it up.
export default async function InvitePage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await getUser()) return <WorkspaceLinkNotice reason="signed-in" />;
  if (!(await workspaceLinkLookupAllowed())) return <WorkspaceLinkNotice reason="rate-limited" />;
  const invite = await findOpenInvite(token);
  if (!invite) return <WorkspaceLinkNotice reason="invalid" />;
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Join {invite.workspaceName} as an agent</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">
          Create your account with {invite.email} to start working the support queue.
        </p>
      </div>
      <SignupForm invite={{ token, email: invite.email }} />
    </div>
  );
}
