import Link from "next/link";

import { requireRole } from "@/app/lib/auth/session";
import { NewTicketForm } from "./NewTicketForm";

export default async function NewTicketPage() {
  await requireRole("customer");

  return (
    <div className="mx-auto flex w-full max-w-lg flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/tickets" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          &larr; My tickets
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">New ticket</h1>
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        <NewTicketForm />
      </div>
    </div>
  );
}
