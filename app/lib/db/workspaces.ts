import "server-only";

import { createHash } from "node:crypto";

import { createServerSupabaseClient } from "@/app/lib/auth/clients";
import { RateLimitError } from "@/app/lib/db/rate-limit";
import { visitorIp } from "@/app/lib/request-ip";
import { createServiceSupabaseClient } from "@/app/lib/supabase/service";

// Workspaces (SUP-78, part 2: SUP-82). Sign-up picks the workspace: the
// ticketing.handle_new_user() trigger reads a workspace name, a customer
// join token or an agent invite token from the sign-up metadata and checks
// it. The admin functions below run with the caller's session (the RPCs
// check they're an admin of their own workspace). The two lookups for the
// signed-out /join and /invite pages use the service role, since there's no
// session yet; they return only a workspace's name and an invite's email.

export type WorkspaceInvite = {
  id: string;
  email: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
};

export class InviteRefusedError extends Error {
  constructor(public reason: "invalid_email" | "already_has_account") {
    super(reason);
    this.name = "InviteRefusedError";
  }
}

// The same sha256 hex the database keeps for an invite.
function inviteHash(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

// The signed-out /join and /invite pages' per-IP limit (30 every 5
// minutes): false = too many lookups from this visitor just now.
export async function workspaceLinkLookupAllowed(): Promise<boolean> {
  const { data, error } = await createServiceSupabaseClient().rpc("consume_workspace_link_rate_limit", {
    p_ip: await visitorIp(),
  });
  if (error) throw new Error(error.message);
  return data === true;
}

// The workspace behind a customer join link, or null.
export async function findWorkspaceByJoinToken(token: string): Promise<{ name: string } | null> {
  if (!/^[0-9a-f]{48}$/.test(token)) return null;
  const { data, error } = await createServiceSupabaseClient()
    .from("workspaces")
    .select("name")
    .eq("join_token", token)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data;
}

// A usable agent invite (not accepted, revoked or expired), or null.
export async function findOpenInvite(token: string): Promise<{ email: string; workspaceName: string } | null> {
  if (!/^wi_[A-Za-z0-9_-]{43}$/.test(token)) return null;
  const { data, error } = await createServiceSupabaseClient()
    .from("workspace_invites")
    .select("email, expires_at, accepted_at, revoked_at, workspace:workspaces(name)")
    .eq("token_hash", inviteHash(token))
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data || data.accepted_at || data.revoked_at || new Date(data.expires_at) <= new Date()) return null;
  const workspace = data.workspace as unknown as { name: string };
  return { email: data.email, workspaceName: workspace.name };
}

// The caller's own workspace name (RLS shows members only their own).
export async function getWorkspaceName(workspaceId: string): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.from("workspaces").select("name").eq("id", workspaceId).single();
  if (error) throw new Error(error.message);
  return data.name;
}

export async function getJoinToken(): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("workspace_join_token");
  if (error) throw new Error(error.message);
  return data as string;
}

export async function rotateJoinToken(): Promise<void> {
  const supabase = await createServerSupabaseClient();
  const { error } = await supabase.rpc("rotate_workspace_join_token");
  if (error) {
    if (error.message.includes("rate_limited")) throw new RateLimitError("workspace_join_rotate");
    throw new Error(error.message);
  }
}

export async function listInvites(): Promise<WorkspaceInvite[]> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase
    .from("workspace_invites")
    .select("id, email, created_at, expires_at, accepted_at, revoked_at")
    .order("created_at", { ascending: false })
    .limit(50);
  if (error) throw new Error(error.message);
  return data;
}

// Returns the invite's token, shown once: only its hash is stored.
export async function createInvite(email: string): Promise<string> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("create_workspace_invite", { p_email: email });
  if (error) {
    if (error.message.includes("invalid_email")) throw new InviteRefusedError("invalid_email");
    if (error.message.includes("rate_limited")) throw new RateLimitError("workspace_invite");
    throw new Error(error.message);
  }
  // Returned, not raised, so the attempt still counts against the limit.
  if ((data as { error?: string }).error === "already_has_account") {
    throw new InviteRefusedError("already_has_account");
  }
  return (data as { token: string }).token;
}

export async function revokeInvite(id: string): Promise<boolean> {
  const supabase = await createServerSupabaseClient();
  const { data, error } = await supabase.rpc("revoke_workspace_invite", { p_id: id });
  if (error) throw new Error(error.message);
  return Boolean(data);
}
