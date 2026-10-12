"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";

// One live region for the whole queue: a card can vanish after its action
// (claimed by someone else, moved out of the current tab), so its own
// region would take the message with it.
type Message = { text: string; tone: "ok" | "error"; seq: number };

const AnnounceContext = createContext<(text: string, tone: "ok" | "error") => void>(() => {});

export function useAnnounce() {
  return useContext(AnnounceContext);
}

export function QueueAnnouncer({ children }: { children: React.ReactNode }) {
  const [message, setMessage] = useState<Message | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const announce = useCallback((text: string, tone: "ok" | "error") => {
    // seq: the same text twice in a row is still re-announced.
    setMessage((m) => ({ text, tone, seq: (m?.seq ?? 0) + 1 }));
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setMessage(null), 6000);
  }, []);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  return (
    <AnnounceContext.Provider value={announce}>
      {children}
      {/* A toast at the bottom of the screen, so it takes no room in the
          page; the region itself is always present for screen readers. */}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
        {message ? (
          <span
            key={message.seq}
            className={`rounded-full px-4 py-2 text-sm font-medium shadow-lg ${
              message.tone === "error"
                ? "bg-red-600 text-white"
                : "bg-zinc-900 text-white dark:bg-zinc-100 dark:text-zinc-900"
            }`}
          >
            {message.text}
          </span>
        ) : null}
      </div>
    </AnnounceContext.Provider>
  );
}
