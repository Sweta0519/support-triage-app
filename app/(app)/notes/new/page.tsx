import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { NoteForm } from "../NoteForm";

export default async function NewNotePage() {
  await requireStaff();

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div>
        <Link href="/notes" className="text-xs font-medium text-indigo-600 hover:underline dark:text-indigo-400">
          &larr; Notes
        </Link>
        <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">New note</h1>
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        <NoteForm />
      </div>
    </div>
  );
}
