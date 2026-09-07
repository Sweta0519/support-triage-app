import { Breadcrumbs } from "@/app/components/Breadcrumbs";
import { NOTES_CRUMB } from "@/app/lib/crumbs";
import { notFound } from "next/navigation";

import { requireStaff } from "@/app/lib/auth/session";
import { getNote } from "@/app/lib/db/notes";
import { isUuid } from "@/app/lib/db/tickets";
import { formatRelativeTime } from "@/app/lib/format";
import { secondaryButtonClass } from "@/app/lib/styles";
import { NoteForm } from "../NoteForm";
import { deleteNoteAction } from "../actions";

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  await requireStaff();
  const { id } = await params;
  if (!isUuid(id)) {
    notFound();
  }

  // RLS: another staff member's note comes back as null and 404s -- the
  // same "not found, not forbidden" answer tickets give.
  const note = await getNote(id);
  if (!note) {
    notFound();
  }

  return (
    <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col gap-6 p-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <Breadcrumbs parents={[NOTES_CRUMB]} current={note.title} />
          <h1 className="mt-2 text-2xl font-semibold text-black dark:text-zinc-50">Edit note</h1>
          <p className="mt-1 text-xs text-zinc-400 dark:text-zinc-600">
            Last saved {formatRelativeTime(note.updated_at)}
          </p>
        </div>
        <form action={deleteNoteAction}>
          <input type="hidden" name="noteId" value={note.id} />
          <button
            type="submit"
            className={`${secondaryButtonClass} !text-red-600 hover:!bg-red-50 dark:!text-red-400 dark:hover:!bg-red-950/40`}
          >
            Delete note
          </button>
        </form>
      </div>
      <div className="rounded-xl border border-black/[.08] p-6 dark:border-white/[.145]">
        <NoteForm note={{ id: note.id, title: note.title, body: note.body }} />
      </div>
    </div>
  );
}
