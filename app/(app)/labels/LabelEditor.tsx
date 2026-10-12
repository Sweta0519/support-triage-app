"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

import { createLabelAction, deleteLabelAction, updateLabelAction } from "./actions";
import { LABEL_COLORS, LABEL_NAME_MAX_LENGTH, labelDot, type LabelColor, type TeamLabel } from "@/app/lib/labels";
import { inputClass, primaryButtonClass, secondaryButtonClass } from "@/app/lib/styles";

const COLORS = Object.keys(LABEL_COLORS) as LabelColor[];

function ColorPicker({ value, onChange, name }: { value: LabelColor; onChange: (c: LabelColor) => void; name: string }) {
  return (
    <div role="radiogroup" aria-label={`Colour for ${name}`} className="flex flex-wrap gap-1">
      {COLORS.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={value === c}
          aria-label={c}
          onClick={() => onChange(c)}
          className={`h-5 w-5 rounded-full ${LABEL_COLORS[c]} ${value === c ? "ring-2 ring-offset-2 ring-indigo-500 dark:ring-offset-zinc-950" : ""}`}
        />
      ))}
    </div>
  );
}

export function LabelEditor({ label }: { label: TeamLabel }) {
  const router = useRouter();
  const [name, setName] = useState(label.name);
  const [color, setColor] = useState<LabelColor>(label.color);
  // After a refresh shows someone else's rename or recolour, the row follows
  // it, so Save can't quietly put the old values back.
  const [shown, setShown] = useState({ name: label.name, color: label.color });
  if (shown.name !== label.name || shown.color !== label.color) {
    setShown({ name: label.name, color: label.color });
    setName(label.name);
    setColor(label.color);
  }
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const changed = name.trim() !== label.name || color !== label.color;

  return (
    <li className="flex flex-col gap-2 p-4">
      <div className="flex flex-wrap items-center gap-3">
        <span aria-hidden className={`h-2.5 w-2.5 rounded-full ${labelDot(color)}`} />
        <input
          value={name}
          maxLength={LABEL_NAME_MAX_LENGTH}
          onChange={(e) => setName(e.target.value)}
          aria-label={`Name of label ${label.name}`}
          className={`${inputClass} max-w-56 !py-1`}
        />
        <ColorPicker value={color} onChange={setColor} name={label.name} />
        <div className="ml-auto flex gap-2">
          {changed ? (
            <button
              type="button"
              className={`${primaryButtonClass} !px-3 !py-1 !text-xs`}
              onClick={async () => {
                const r = await updateLabelAction(label.id, name, color);
                setError(r.ok ? null : r.error);
                router.refresh();
              }}
            >
              Save
            </button>
          ) : null}
          {confirming ? (
            <>
              <button
                type="button"
                className="rounded-full bg-red-600 px-3 py-1 text-xs font-medium text-white hover:bg-red-500"
                onClick={async () => {
                  const r = await deleteLabelAction(label.id);
                  if (!r.ok) setError(r.error);
                  router.refresh();
                }}
              >
                Delete “{label.name}”
              </button>
              <button type="button" className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`} onClick={() => setConfirming(false)}>
                Cancel
              </button>
            </>
          ) : (
            <button type="button" className={`${secondaryButtonClass} !px-3 !py-1 !text-xs`} onClick={() => setConfirming(true)}>
              Delete
            </button>
          )}
        </div>
      </div>
      {confirming ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">This takes the label off every ticket that has it.</p>
      ) : null}
      {error ? (
        <p role="alert" className="text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </li>
  );
}

export function NewLabelForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [color, setColor] = useState<LabelColor>("blue");
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-black/[.15] p-4 dark:border-white/[.2]"
      onSubmit={async (e) => {
        e.preventDefault();
        const r = await createLabelAction(name, color);
        if (!r.ok) {
          setError(r.error);
          return;
        }
        setError(null);
        setName("");
        router.refresh();
      }}
    >
      <input
        value={name}
        maxLength={LABEL_NAME_MAX_LENGTH}
        onChange={(e) => setName(e.target.value)}
        placeholder="New label name"
        aria-label="New label name"
        className={`${inputClass} max-w-56 !py-1`}
      />
      <ColorPicker value={color} onChange={setColor} name="the new label" />
      <button type="submit" className={`${primaryButtonClass} ml-auto !px-3 !py-1 !text-xs`}>
        Create label
      </button>
      {error ? (
        <p role="alert" className="w-full text-xs text-red-600 dark:text-red-400">
          {error}
        </p>
      ) : null}
    </form>
  );
}
