import Link from "next/link";

import { getUser, requireProfile } from "@/app/lib/auth/session";
import { afterSignIn } from "@/app/lib/auth/after-sign-in";
import { linkClass } from "@/app/lib/styles";
import { AppSidebar } from "@/app/components/AppSidebar";
import { AssistantWidget } from "@/app/components/assistant/AssistantWidget";
import { AiTriageBanner } from "@/app/components/AiTriageBanner";
import { IncidentBanner, type BannerIncident } from "@/app/components/IncidentBanner";
import { listOpenIncidentsWithCounts } from "@/app/lib/db/incidents";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { listRecentFinishedTriageRuns } from "@/app/lib/db/triage";
import { countPendingAccessRequests } from "@/app/lib/db/access-requests";
import { aiTriageHealth, HEALTH_SAMPLE, type AiTriageHealth } from "@/app/lib/triage-status";

// The AI triage banner's input. Best effort: the banner is a hint, so a
// failed health query logs and shows nothing rather than breaking every
// staff page. With no key there's nothing to query.
async function triageHealth(workspaceId: string): Promise<AiTriageHealth> {
  const configured = isAiConfigured();
  if (!configured) return aiTriageHealth(false, []);
  try {
    return aiTriageHealth(true, await listRecentFinishedTriageRuns(workspaceId, HEALTH_SAMPLE));
  } catch (err) {
    console.error("[layout] AI triage health check failed:", err instanceof Error ? err.message : err);
    return { kind: "ok" };
  }
}

// Pending access requests for the admin sidebar (SUP-68). Best effort too.
async function pendingAccessRequests(): Promise<number> {
  try {
    return await countPendingAccessRequests();
  } catch (err) {
    console.error("[layout] access request count failed:", err instanceof Error ? err.message : err);
    return 0;
  }
}

// Open incidents for the staff banner (SUP-42). Best effort, like the
// health check: a failed read shows no banner rather than breaking the page.
async function openIncidents(workspaceId: string): Promise<BannerIncident[]> {
  try {
    return await listOpenIncidentsWithCounts(workspaceId, 2);
  } catch (err) {
    console.error("[layout] open incidents read failed:", err instanceof Error ? err.message : err);
    return [];
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const staff = profile.role !== "customer";
  // An access request that couldn't be filed at sign-in (SUP-58) is tried
  // again on the next page, while the session still carries its answers.
  if (!staff) {
    const metadata = (await getUser())?.user_metadata as Record<string, unknown> | undefined;
    if (metadata?.access_request) await afterSignIn(metadata);
  }
  // Staff only: customers never see triage, working or not.
  const [health, incidents, accessRequests] = await Promise.all([
    staff ? triageHealth(profile.workspace_id) : null,
    staff ? openIncidents(profile.workspace_id) : ([] as BannerIncident[]),
    profile.role === "admin" ? pendingAccessRequests() : 0,
  ]);

  return (
    // Sidebar on the left from lg up, a top bar on phones; the page and
    // footer take the remaining width. data-theme carries the theme picked
    // on the account page (see the dark variant in globals.css); "system"
    // leaves it off so the device setting decides.
    <div
      data-theme={profile.theme === "system" ? undefined : profile.theme}
      className="flex flex-1 flex-col lg:flex-row"
    >
      <AppSidebar
        profile={{
          id: profile.id,
          email: profile.email,
          fullName: profile.full_name,
          avatarPath: profile.avatar_path,
          role: profile.role,
          presence: staff ? profile.presence : null,
        }}
        accessRequests={accessRequests}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {health ? <AiTriageBanner health={health} isAdmin={profile.role === "admin"} /> : null}
        <IncidentBanner incidents={incidents} />
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="border-t border-black/[.08] dark:border-white/[.145]">
          <div className="flex w-full max-w-screen-2xl items-center justify-end px-8 py-3">
            <Link href="/privacy" className={`text-xs ${linkClass}`}>
              Privacy policy
            </Link>
          </div>
        </footer>
      </div>
      {staff ? <AssistantWidget /> : null}
    </div>
  );
}
