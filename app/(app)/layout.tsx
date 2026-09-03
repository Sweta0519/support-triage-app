import { requireProfile } from "@/app/lib/auth/session";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await requireProfile();

  return <div className="flex flex-1 flex-col">{children}</div>;
}
