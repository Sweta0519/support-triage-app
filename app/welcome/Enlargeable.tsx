"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

import styles from "./welcome.module.css";

// Click to enlarge (SUP-62): the framed screenshot is a button that opens the
// full-resolution image in a native modal <dialog>. Escape or Close shuts it,
// the browser returns focus to the button, the page behind doesn't scroll,
// and the full image only loads once it's opened.
export function Enlargeable({ src, alt, children }: { src: string; alt: string; children: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    const before = root.style.overflow;
    root.style.overflow = "hidden";
    return () => {
      root.style.overflow = before;
    };
  }, [open]);

  return (
    <>
      <button
        type="button"
        aria-label={`Enlarge: ${alt}`}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        className="block w-full cursor-zoom-in rounded-xl text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-[#8B83FF]"
      >
        {children}
      </button>
      <dialog
        ref={dialog}
        aria-label={alt}
        onClose={() => setOpen(false)}
        // A click on the backdrop (the dialog itself, outside the figure) closes it.
        onClick={(e) => {
          if (e.target === e.currentTarget) dialog.current?.close();
        }}
        className={`${styles.lightbox} m-auto max-h-[94vh] max-w-[96vw] bg-transparent p-0`}
      >
        <div className="flex flex-col items-end gap-3">
          <button
            type="button"
            onClick={() => dialog.current?.close()}
            className="rounded-lg bg-white/10 px-3 py-1.5 text-[14px] font-medium text-white hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            Close
          </button>
          {open ? (
            // eslint-disable-next-line @next/next/no-img-element -- the full-resolution original, at its own size
            <img src={src} alt={alt} className="block max-h-[86vh] w-auto max-w-[96vw] rounded-lg object-contain" />
          ) : null}
        </div>
      </dialog>
    </>
  );
}
