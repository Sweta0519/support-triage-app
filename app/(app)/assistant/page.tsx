import { requireStaff } from "@/app/lib/auth/session";
import { getOrCreateActiveConversation, listMessages } from "@/app/lib/db/assistant";
import { ChatForm } from "./ChatForm";

export default async function AssistantPage() {
  const profile = await requireStaff();
  const conversationId = await getOrCreateActiveConversation(profile.id);
  const messages = await listMessages(conversationId);

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-6 p-8">
      <div>
        <h1 className="text-2xl font-semibold text-black dark:text-zinc-50">Assistant</h1>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-500">
          A private scratchpad for thinking through tickets and drafting replies. Nothing here is
          ever shown to a customer.
        </p>
      </div>

      <div className="flex flex-1 flex-col gap-3 rounded-xl border border-black/[.08] p-4 dark:border-white/[.145]">
        {messages.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
            <p className="text-sm font-medium text-zinc-600 dark:text-zinc-400">
              No messages yet
            </p>
            <p className="text-xs text-zinc-400 dark:text-zinc-600">
              Ask it anything -- it&apos;ll remember this conversation.
            </p>
          </div>
        ) : (
          <ul className="flex flex-col gap-3">
            {messages.map((message) => {
              const isUser = message.role === "user";
              return (
                <li
                  key={message.id}
                  className={`flex ${isUser ? "justify-end" : "justify-start"}`}
                >
                  <div
                    className={`max-w-[80%] whitespace-pre-wrap rounded-lg px-4 py-2 text-sm ${
                      isUser
                        ? "bg-indigo-600 text-white"
                        : "border border-black/[.08] text-black dark:border-white/[.145] dark:text-zinc-50"
                    }`}
                  >
                    {message.content}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>

      <ChatForm />
    </div>
  );
}
