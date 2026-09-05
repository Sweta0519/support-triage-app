import { requireProfile } from "@/app/lib/auth/session";
import { AppHeader } from "@/app/components/AppHeader";

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
    </div>
  );
}
