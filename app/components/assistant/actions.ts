"use server";

import { requireStaff } from "@/app/lib/auth/session";
import {
  ASSISTANT_MESSAGE_MAX_LENGTH,
  appendMessage,
  getOrCreateActiveConversation,
  listMessages,
  listRecentMessages,
  type AssistantMessage,
} from "@/app/lib/db/assistant";
import { checkRateLimit, RateLimitError } from "@/app/lib/db/rate-limit";
import { completeChat, type ChatMessage } from "@/app/lib/ai/openrouter";
import { ASSISTANT_NAME } from "./constants";

const RATE_LIMITED_MESSAGE =
  "You're doing that too often. Please wait a few minutes and try again.";

// A conversation is kept forever, so without a cap its full history would
// ride along on every send -- growing latency and cost turn over turn. The
// full history still loads for display; only what's sent to the model is
// bounded.
const HISTORY_MESSAGES_SENT_TO_MODEL = 20;

// Not customer-facing: nothing this assistant says is ever sent to a
// customer automatically. It's a staff scratchpad, kept deliberately
// separate from the advisory ticket-triage pipeline.
const SYSTEM_PROMPT =
  `You are ${ASSISTANT_NAME}, an internal assistant for support agents and ` +
  "admins. Help them think through tickets, draft reply language, and " +
  "answer general questions. You are never shown to customers directly. " +
  `If asked your name, say you're ${ASSISTANT_NAME}.`;

export type AssistantMessageLite = Pick<AssistantMessage, "id" | "role" | "content" | "created_at">;

// Called once, when the widget is first opened -- not on every page load --
// so staff who never open it never pay for the query.
export async function loadAssistantAction(): Promise<{ messages: AssistantMessageLite[] }> {
  const profile = await requireStaff();
  const conversationId = await getOrCreateActiveConversation(profile.id);
  const messages = await listMessages(conversationId);
  return { messages };
}

export type SendMessageResult =
  | { status: "error"; error: string }
  | { status: "ok"; userMessage: AssistantMessageLite; reply: AssistantMessageLite };

// Called directly (not bound to a <form>'s action prop) so the widget can
// work as a floating overlay on any staff page, appending the result to its
// own local state rather than relying on a page-level revalidation.
export async function sendMessageAction(content: string): Promise<SendMessageResult> {
  const profile = await requireStaff();
  const trimmed = content.trim();

  if (!trimmed) {
    return { status: "error", error: "Message can't be empty." };
  }
  if (trimmed.length > ASSISTANT_MESSAGE_MAX_LENGTH) {
    return {
      status: "error",
      error: `Message must be at most ${ASSISTANT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`,
    };
  }

  // A chat send is a paid model call with no insert trigger to lean on, so
  // it's checked explicitly here, before the user's message is even saved.
  try {
    await checkRateLimit("assistant_message");
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { status: "error", error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }

  const conversationId = await getOrCreateActiveConversation(profile.id);
  const history = await listRecentMessages(conversationId, HISTORY_MESSAGES_SENT_TO_MODEL);

  const userMessage = await appendMessage(conversationId, "user", trimmed);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m): ChatMessage => ({ role: m.role, content: m.content })),
    { role: "user", content: trimmed },
  ];

  // The user's message is already saved above by this point, so a failure
  // here (timeout, OpenRouter outage, an empty completion) must return a
  // friendly error instead of throwing -- every other AI call site in this
  // app (runTriage's try/catch, rerunTriageAction's RateLimitError
  // handling) guards against exactly this the same way.
  try {
    const completion = await completeChat({ messages });
    const reply = await appendMessage(conversationId, "assistant", completion.text, completion.model);
    return { status: "ok", userMessage, reply };
  } catch {
    return {
      status: "error",
      error: `${ASSISTANT_NAME} couldn't respond just now. Please try again.`,
    };
  }
}
