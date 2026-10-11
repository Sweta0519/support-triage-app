import Link from "next/link";

import { Logo } from "@/app/components/Logo";
import { linkClass } from "@/app/lib/styles";

export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-6 dark:bg-black">
      <div className="flex w-full max-w-sm flex-col items-center gap-8">
        <Logo size={32} />
        <div className="w-full rounded-2xl border border-black/[.08] bg-white p-8 shadow-sm dark:border-white/[.08] dark:bg-zinc-950">
          {children}
        </div>
        <Link href="/privacy" className={`text-xs ${linkClass}`}>
          Privacy policy
        </Link>
      </div>
    </div>
  );
}
