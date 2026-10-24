import { SignupForm } from "../../signup/SignupForm";
import { WorkspaceLinkNotice } from "@/app/components/WorkspaceLinkNotice";
import { getUser } from "@/app/lib/auth/session";
import { findWorkspaceByJoinToken } from "@/app/lib/db/workspaces";

// A workspace's customer sign-up link (SUP-82). Signing up here joins that
// workspace as a customer; the database checks the token again.
export default async function JoinPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (await getUser()) return <WorkspaceLinkNotice signedIn />;
  const workspace = await findWorkspaceByJoinToken(token);
  if (!workspace) return <WorkspaceLinkNotice signedIn={false} />;
  return (
    <div className="flex w-full flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-1 text-center">
        <h1 className="text-xl font-semibold text-black dark:text-zinc-50">Get support from {workspace.name}</h1>
        <p className="text-sm text-zinc-500 dark:text-zinc-500">Create an account to file and track your support tickets.</p>
      </div>
      <SignupForm joinToken={token} />
    </div>
  );
}
