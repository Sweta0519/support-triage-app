import Link from "next/link";

import { requireProfile } from "@/app/lib/auth/session";
import { linkClass } from "@/app/lib/styles";
import { AppSidebar } from "@/app/components/AppSidebar";
import { AssistantWidget } from "@/app/components/assistant/AssistantWidget";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    // Sidebar on the left from lg up, a top bar on phones; the page and
    // footer take the remaining width. data-theme carries the theme picked
    // on the account page (see the dark variant in globals.css); "system"
    // leaves it off so the device setting decides.
    <div
      data-theme={profile.theme === "system" ? undefined : profile.theme}
      className="flex flex-1 flex-col bg-[var(--background)] text-[var(--foreground)] lg:flex-row"
    >
      <AppSidebar profile={{ email: profile.email, role: profile.role }} />
      <div className="flex min-w-0 flex-1 flex-col">
        <main className="flex flex-1 flex-col">{children}</main>
        <footer className="border-t border-black/[.08] dark:border-white/[.145]">
          <div className="flex w-full max-w-screen-2xl items-center justify-end px-8 py-3">
            <Link href="/privacy" className={`text-xs ${linkClass}`}>
              Privacy policy
            </Link>
          </div>
        </footer>
      </div>
      {profile.role !== "customer" ? <AssistantWidget /> : null}
    </div>
  );
}
