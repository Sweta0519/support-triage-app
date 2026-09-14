import Link from "next/link";

import { requireProfile } from "@/app/lib/auth/session";
import { linkClass } from "@/app/lib/styles";
import { AppHeader } from "@/app/components/AppHeader";
import { AssistantWidget } from "@/app/components/assistant/AssistantWidget";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const profile = await requireProfile();

  return (
    <div className="flex flex-1 flex-col">
      <AppHeader profile={profile} />
      <main className="flex flex-1 flex-col">{children}</main>
      <footer className="border-t border-black/[.08] dark:border-white/[.145]">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-end px-6 py-3">
          <Link href="/privacy" className={`text-xs ${linkClass}`}>
            Privacy policy
          </Link>
        </div>
      </footer>
      {profile.role !== "customer" ? <AssistantWidget /> : null}
    </div>
  );
}
