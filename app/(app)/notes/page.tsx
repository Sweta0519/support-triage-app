import Link from "next/link";

import { requireStaff } from "@/app/lib/auth/session";
import { listNotes } from "@/app/lib/db/notes";
import { formatRelativeTime } from "@/app/lib/format";
import { primaryButtonClass } from "@/app/lib/styles";
import { ASSISTANT_NAME } from "@/app/components/assistant/constants";
import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { NOTES_CRUMB } from "@/app/lib/crumbs";

export default async function NotesPage() {
  await requireStaff();
  const notes = await listNotes();

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Breadcrumbs current={NOTES_CRUMB.label} />
          <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Notes</h1>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
            Your private knowledge notes -- runbooks, policies, customer context. {ASSISTANT_NAME}{" "}
            searches these when you ask it something they might answer. Nobody else can see them.
          </p>
        </div>
        <Link href="/notes/new" className={`shrink-0 ${primaryButtonClass}`}>
          New note
        </Link>
      </div>

      {notes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-black/[.12] p-10 text-center text-sm text-zinc-500 dark:border-white/[.16] dark:text-zinc-500">
          No notes yet. Write down something you keep looking up, then ask {ASSISTANT_NAME} about it.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {notes.map((note) => (
            <li key={note.id}>
              <Link
                href={`/notes/${note.id}`}
                className="block rounded-xl border border-black/[.08] p-4 transition-colors hover:bg-black/[.02] dark:border-white/[.145] dark:hover:bg-white/[.03]"
              >
                <div className="flex items-baseline justify-between gap-4">
                  <h2 className="text-sm font-semibold text-black dark:text-zinc-50">{note.title}</h2>
                  <span className="shrink-0 text-xs text-zinc-400 dark:text-zinc-600">
                    {formatRelativeTime(note.updated_at)}
                  </span>
                </div>
                <p className="mt-1 line-clamp-2 text-xs text-zinc-500 dark:text-zinc-500">
                  {note.preview}
                </p>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
