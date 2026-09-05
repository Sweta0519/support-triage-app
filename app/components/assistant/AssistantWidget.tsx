"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { unstable_rethrow } from "next/navigation";
import Markdown from "react-markdown";

import { loadAssistantAction, sendMessageAction, type AssistantMessageLite } from "./actions";
import { ASSISTANT_NAME } from "./constants";
import { inputClass, primaryButtonClass } from "@/app/lib/styles";

// react-markdown's default element spacing is meant for full-width prose;
// overridden here to stay compact inside a narrow chat bubble.
const MARKDOWN_COMPONENTS = {
  p: ({ children }: { children?: React.ReactNode }) => <p className="mb-1.5 last:mb-0">{children}</p>,
  strong: ({ children }: { children?: React.ReactNode }) => (
    <strong className="font-semibold">{children}</strong>
  ),
  ul: ({ children }: { children?: React.ReactNode }) => (
    <ul className="mb-1.5 list-disc pl-4 last:mb-0">{children}</ul>
  ),
  ol: ({ children }: { children?: React.ReactNode }) => (
    <ol className="mb-1.5 list-decimal pl-4 last:mb-0">{children}</ol>
  ),
  li: ({ children }: { children?: React.ReactNode }) => <li className="mb-0.5">{children}</li>,
  h1: ({ children }: { children?: React.ReactNode }) => (
    <h1 className="mb-1 mt-1.5 font-semibold first:mt-0">{children}</h1>
  ),
  h2: ({ children }: { children?: React.ReactNode }) => (
    <h2 className="mb-1 mt-1.5 font-semibold first:mt-0">{children}</h2>
  ),
  h3: ({ children }: { children?: React.ReactNode }) => (
    <h3 className="mb-1 mt-1.5 font-semibold first:mt-0">{children}</h3>
  ),
  code: ({ children }: { children?: React.ReactNode }) => (
    <code className="rounded bg-black/[.06] px-1 py-0.5 font-mono text-[11px] dark:bg-white/[.1]">
      {children}
    </code>
  ),
  a: ({ children, href }: { children?: React.ReactNode; href?: string }) => (
    <a href={href} target="_blank" rel="noreferrer" className="underline">
      {children}
    </a>
  ),
};

export function AssistantWidget() {
  const [open, setOpen] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [messages, setMessages] = useState<AssistantMessageLite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const listRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);

  function loadConversation() {
    startTransition(async () => {
      setError(null);
      try {
        const result = await loadAssistantAction();
        setMessages(result.messages);
        setLoaded(true);
      } catch (err) {
        // requireStaff() inside the action redirects to /403 if this
        // staff member was demoted mid-session -- that's a thrown
        // Next.js navigation signal, not an application error, and must
        // be let through rather than swallowed as "couldn't load".
        unstable_rethrow(err);
        setError(`Couldn't load ${ASSISTANT_NAME}. Please try again.`);
      }
    });
  }

  // Fetched once, the first time the widget is opened -- not on every page
  // load -- so staff who never open it never pay for the query.
  useEffect(() => {
    if (!open || loaded) {
      return;
    }
    loadConversation();
  }, [open, loaded]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages]);

  function handleSubmit(formData: FormData) {
    const content = String(formData.get("content") ?? "").trim();
    if (!content) {
      return;
    }
    setError(null);
    startTransition(async () => {
      try {
        const result = await sendMessageAction(content);
        if (result.status === "error") {
          setError(result.error);
          return;
        }
        setMessages((prev) => [...prev, result.userMessage, result.reply]);
        // Only clear the draft once the send actually succeeded -- on
        // failure the agent's typed message stays so they don't lose it.
        formRef.current?.reset();
      } catch (err) {
        unstable_rethrow(err);
        setError(`${ASSISTANT_NAME} couldn't respond just now. Please try again.`);
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-label={open ? `Close ${ASSISTANT_NAME}` : `Open ${ASSISTANT_NAME}`}
        className="fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-indigo-600 text-white shadow-lg transition-transform hover:scale-105 hover:bg-indigo-500"
      >
        {open ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
            <path strokeLinecap="round" strokeLinejoin="round" d="M6 18 18 6M6 6l12 12" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="h-6 w-6">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z"
            />
          </svg>
        )}
      </button>

      {open ? (
        <div className="fixed bottom-24 right-6 z-50 flex h-[32rem] w-[22rem] max-w-[calc(100vw-3rem)] flex-col overflow-hidden rounded-xl border border-black/[.08] bg-[var(--background)] shadow-2xl dark:border-white/[.145]">
          <div className="flex items-center justify-between border-b border-black/[.08] px-4 py-3 dark:border-white/[.145]">
            <div>
              <p className="text-sm font-semibold text-black dark:text-zinc-50">{ASSISTANT_NAME}</p>
              <p className="text-xs text-zinc-500 dark:text-zinc-500">Private staff assistant</p>
            </div>
          </div>

          <div ref={listRef} className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
            {!loaded ? (
              isPending ? (
                <p className="m-auto text-xs text-zinc-400 dark:text-zinc-600">Loading...</p>
              ) : (
                <div className="m-auto flex flex-col items-center gap-2 text-center">
                  <p className="text-xs text-red-600 dark:text-red-400">{error}</p>
                  <button
                    type="button"
                    onClick={loadConversation}
                    className="text-xs font-medium text-indigo-600 underline-offset-2 hover:underline dark:text-indigo-400"
                  >
                    Try again
                  </button>
                </div>
              )
            ) : messages.length === 0 ? (
              <p className="m-auto max-w-[85%] text-center text-xs text-zinc-400 dark:text-zinc-600">
                Ask {ASSISTANT_NAME} anything -- it&apos;ll remember this conversation. Nothing here
                is ever shown to a customer.
              </p>
            ) : (
              messages.map((message) => {
                const isUser = message.role === "user";
                return (
                  <div key={message.id} className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
                    <div
                      data-testid="assistant-widget-message"
                      data-role={message.role}
                      className={`max-w-[85%] rounded-lg px-3 py-1.5 text-xs ${
                        isUser
                          ? "whitespace-pre-wrap bg-indigo-600 text-white"
                          : "border border-black/[.08] text-black dark:border-white/[.145] dark:text-zinc-50"
                      }`}
                    >
                      {isUser ? (
                        message.content
                      ) : (
                        <Markdown components={MARKDOWN_COMPONENTS}>{message.content}</Markdown>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* A load failure gets its own retry UI above; this is only for a send failure. */}
          {loaded && error ? (
            <p className="border-t border-black/[.08] px-3 py-1.5 text-xs text-red-600 dark:border-white/[.145] dark:text-red-400">
              {error}
            </p>
          ) : null}

          <form
            ref={formRef}
            action={handleSubmit}
            className="flex items-end gap-2 border-t border-black/[.08] p-3 dark:border-white/[.145]"
          >
            <textarea
              name="content"
              placeholder={`Message ${ASSISTANT_NAME}...`}
              required
              rows={1}
              disabled={!loaded || isPending}
              className={`${inputClass} flex-1 resize-none !py-1.5 !text-xs`}
            />
            <button
              type="submit"
              disabled={!loaded || isPending}
              className={`${primaryButtonClass} !px-3 !py-1.5 !text-xs`}
            >
              Send
            </button>
          </form>
        </div>
      ) : null}
    </>
  );
}
