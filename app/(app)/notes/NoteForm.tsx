"use client";

import { useActionState } from "react";

import { createNoteAction, updateNoteAction, type NoteFormState } from "./actions";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";

export function NoteForm({ note }: { note?: { id: string; title: string; body: string } }) {
  const [state, action, pending] = useActionState<NoteFormState, FormData>(
    note ? updateNoteAction : createNoteAction,
    undefined
  );

  return (
    <form action={action} className="flex w-full flex-col gap-4">
      {note ? <input type="hidden" name="noteId" value={note.id} /> : null}
      <div className="flex flex-col gap-1.5">
        <label htmlFor="title" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Title
        </label>
        <input
          id="title"
          name="title"
          type="text"
          placeholder="Title"
          required
          defaultValue={note?.title}
          className={inputClass}
        />
      </div>
      <div className="flex flex-col gap-1.5">
        <label htmlFor="body" className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
          Note
        </label>
        <textarea
          id="body"
          name="body"
          placeholder="Write the note..."
          required
          rows={12}
          defaultValue={note?.body}
          className={inputClass}
        />
      </div>
      {state?.error ? (
        <p className="text-sm text-red-600 dark:text-red-400">{state.error}</p>
      ) : null}
      <div className="flex items-center gap-3">
        <button type="submit" disabled={pending} className={primaryButtonClass}>
          {pending ? "Saving..." : "Save note"}
        </button>
        {state?.saved && !pending ? (
          <span className="text-xs text-emerald-700 dark:text-emerald-400">Saved.</span>
        ) : null}
      </div>
    </form>
  );
}
