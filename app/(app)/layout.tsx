import Link from "next/link";

import { requireProfile } from "@/app/lib/auth/session";
import { linkClass } from "@/app/lib/styles";
import { AppSidebar } from "@/app/components/AppSidebar";
import { AssistantWidget } from "@/app/components/assistant/AssistantWidget";
import { AiTriageBanner } from "@/app/components/AiTriageBanner";
import { isAiConfigured } from "@/app/lib/ai/openrouter";
import { listRecentFinishedTriageRuns } from "@/app/lib/db/triage";
import { aiTriageHealth, HEALTH_SAMPLE, type AiTriageHealth } from "@/app/lib/triage-status";

// The AI triage banner's input. Best effort: the banner is a hint, so a
// failed health query logs and shows nothing rather than breaking every
// staff page. With no key there's nothing to query.
async function triageHealth(): Promise<AiTriageHealth> {
  const configured = isAiConfigured();
  if (!configured) return aiTriageHealth(false, []);
  try {
    return aiTriageHealth(true, await listRecentFinishedTriageRuns(HEALTH_SAMPLE));
  } catch (err) {
    console.error("[layout] AI triage health check failed:", err instanceof Error ? err.message : err);
    return { kind: "ok" };
  }
}

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();
  const staff = profile.role !== "customer";
  // Staff only: customers never see triage, working or not.
  const health = staff ? await triageHealth() : null;

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
        }}
      />
      <div className="flex min-w-0 flex-1 flex-col">
        {health ? <AiTriageBanner health={health} isAdmin={profile.role === "admin"} /> : null}
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
