"use server";

import { revalidatePath } from "next/cache";

import { requireStaff } from "@/app/lib/auth/session";
import {
  ASSISTANT_MESSAGE_MAX_LENGTH,
  appendMessage,
  getOrCreateActiveConversation,
  listRecentMessages,
} from "@/app/lib/db/assistant";
import { checkRateLimit, RateLimitError } from "@/app/lib/db/rate-limit";
import { completeChat, type ChatMessage } from "@/app/lib/ai/openrouter";

const RATE_LIMITED_MESSAGE =
  "You're doing that too often. Please wait a few minutes and try again.";

// A conversation is kept forever, so without a cap its full history would
// ride along on every send -- growing latency and cost turn over turn. The
// full history still renders on the page; only what's sent to the model is
// bounded.
const HISTORY_MESSAGES_SENT_TO_MODEL = 20;

// Not customer-facing: nothing this assistant says is ever sent to a
// customer automatically. It's a staff scratchpad, kept deliberately
// separate from the advisory ticket-triage pipeline.
const SYSTEM_PROMPT =
  "You are an internal assistant for support agents and admins. Help them " +
  "think through tickets, draft reply language, and answer general " +
  "questions. You are never shown to customers directly.";

export type AssistantFormState = { error: string } | undefined;

export async function sendMessageAction(
  _prevState: AssistantFormState,
  formData: FormData
): Promise<AssistantFormState> {
  const profile = await requireStaff();
  const content = String(formData.get("content") ?? "").trim();

  if (!content) {
    return { error: "Message can't be empty." };
  }
  if (content.length > ASSISTANT_MESSAGE_MAX_LENGTH) {
    return {
      error: `Message must be at most ${ASSISTANT_MESSAGE_MAX_LENGTH.toLocaleString()} characters.`,
    };
  }

  // A chat send is a paid model call with no insert trigger to lean on, so
  // it's checked explicitly here, before the user's message is even saved.
  try {
    await checkRateLimit("assistant_message");
  } catch (err) {
    if (err instanceof RateLimitError) {
      return { error: RATE_LIMITED_MESSAGE };
    }
    throw err;
  }

  const conversationId = await getOrCreateActiveConversation(profile.id);
  const history = await listRecentMessages(conversationId, HISTORY_MESSAGES_SENT_TO_MODEL);

  await appendMessage(conversationId, "user", content);

  const messages: ChatMessage[] = [
    { role: "system", content: SYSTEM_PROMPT },
    ...history.map((m): ChatMessage => ({ role: m.role, content: m.content })),
    { role: "user", content },
  ];

  // The user's message is already saved above by this point, so a failure
  // here (timeout, OpenRouter outage, an empty completion) must return a
  // friendly error instead of throwing out of the action -- every other AI
  // call site in this app (runTriage's try/catch, rerunTriageAction's
  // RateLimitError handling) guards against exactly this the same way.
  try {
    const completion = await completeChat({ messages });
    await appendMessage(conversationId, "assistant", completion.text, completion.model);
  } catch {
    revalidatePath("/assistant");
    return { error: "The assistant couldn't respond just now. Please try again." };
  }

  revalidatePath("/assistant");
  return undefined;
}
