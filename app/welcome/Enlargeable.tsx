"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./welcome.module.css";

// Click to enlarge (SUP-62): the framed screenshot is a button that opens the
// full-resolution image in a native modal <dialog>. Escape, Close or a click
// outside the image shuts it, the browser returns focus to the button, the
// page behind doesn't scroll, and the full image only loads once it's opened.
// `fit` sizes the button to its content (the phone, centred by its parent)
// instead of the full row (the windows).
export function Enlargeable({ src, alt, fit = false, children }: { src: string; alt: string; fit?: boolean; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const content = useRef<HTMLDivElement>(null);
  // Where the pointer went down: a drag that starts on the image and ends
  // outside it isn't a click outside.
  const downOutside = useRef(false);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    // Keep the scrollbar's space while the page is locked, so nothing jumps
    // sideways where scrollbars take up room.
    const root = document.documentElement;
    const before = { overflow: root.style.overflow, gutter: root.style.scrollbarGutter };
    root.style.scrollbarGutter = "stable";
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before.overflow;
      root.style.scrollbarGutter = before.gutter;
    };
  }, [open]);

  const outside = (target: EventTarget | null) => !content.current?.contains(target as Node);

  return (
    <>
      <button
        type="button"
        aria-label={`Enlarge: ${alt}`}
        onClick={() => {
          // The dialog first, then state, so they can't disagree if it throws.
          dialog.current?.showModal();
          setOpen(true);
        }}
        className={`${fit ? "inline-block" : "block w-full"} cursor-zoom-in rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8B83FF]`}
      >
        {children}
      </button>
      <dialog
        ref={dialog}
        aria-label={alt}
        onClose={() => setOpen(false)}
        onPointerDown={(e) => {
          downOutside.current = outside(e.target);
        }}
        // Closes on a click anywhere outside the Close button and the image,
        // including the empty space around a narrow image.
        onClick={(e) => {
          if (downOutside.current && outside(e.target)) dialog.current?.close();
        }}
        className={`${styles.lightbox} m-auto max-h-[94dvh] max-w-[96vw] bg-transparent p-0`}
      >
        <div className="flex flex-col items-end gap-3">
          <button
            type="button"
            // The first thing a keyboard user can act on.
            autoFocus
            onClick={() => dialog.current?.close()}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Close
          </button>
          <div ref={content} className="w-fit">
            {open ? (
              // The dialog's own name already describes the image, so the
              // image itself is not announced a second time.
              // eslint-disable-next-line @next/next/no-img-element -- the full-resolution original, at its own size
              <img src={src} alt="" decoding="async" className="block max-h-[calc(94dvh-3.25rem)] w-auto max-w-[96vw] rounded-lg object-contain" />
            ) : null}
          </div>
        </div>
      </dialog>
    </>
  );
}
