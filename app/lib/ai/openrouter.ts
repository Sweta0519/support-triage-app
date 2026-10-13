import "server-only";

// Thin fetch wrappers over OpenRouter's REST API. Server-only: this module
// is the only place OPENROUTER_API_KEY is ever read.

import { AttemptError, withRetries, type AttemptFailure, type RetryPolicy } from "./retry-policy";

const BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter slugs use dotted versions ("4.5"), unlike Anthropic's own
// hyphenated ids. Haiku 4.5 rather than Sonnet 4.6: this workspace's
// OpenRouter guardrail blocks Sonnet-tier endpoints (GET /api/v1/models/user
// lists what the key may actually use), and closed-schema classification is
// squarely Haiku's job. Switching models is a one-line change here.
export const TRIAGE_MODEL = "anthropic/claude-haiku-4.5";
// Separate constant from TRIAGE_MODEL, even though it starts out equal to
// it: the staff assistant and triage are independent features, and this is
// the one line that changes to switch the assistant's model.
export const ASSISTANT_MODEL = "anthropic/claude-haiku-4.5";
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
// Must match the vector(1536) columns on ticketing.ticket_embeddings and
// ticketing.documents. Never change one without the others -- and never
// change the embedding model at all after setup without re-embedding every
// row.
export const EMBEDDING_DIMENSIONS = 1536;

const REQUEST_TIMEOUT_MS = 45_000;

export function isAiConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function authHeaders(): HeadersInit {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  return {
    Authorization: `Bearer ${key}`,
    "Content-Type": "application/json",
    // Optional attribution headers OpenRouter asks for.
    "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL ?? "http://localhost:3000",
    "X-Title": "Support Ticket Triage",
  };
}

export class OpenRouterError extends Error {
  constructor(
    message: string,
    readonly status: number,
    // What kind of failure it was (HTTP status, network, our timeout), for
    // the retry policy and for the reason staff see on a failed triage.
    readonly failure: AttemptFailure = { kind: "http", status, retryAfter: null }
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

// The provider answered, but not with something we can use: an empty or
// non-JSON completion, or a non-JSON body. Typed so triage can say
// "invalid_response" without matching on message text.
export class InvalidResponseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidResponseError";
  }
}

// One request, retried only as `retry` allows (app/lib/ai/retry-policy.ts,
// SUP-32): never for interactive calls, a little for background triage.
// Returns how many retries it took, so triage can record it.
// `signal`: the caller gave up on this request (triage aborts the sibling
// call once one of its two calls has failed). A cancelled request is never
// retried and isn't a provider failure.
async function post<T>(
  path: string,
  body: unknown,
  retry: RetryPolicy,
  signal?: AbortSignal
): Promise<{ value: T; retries: number }> {
  return withRetries(path, retry, async () => {
    signal?.throwIfAborted();
    // Everything up to and including reading the body is one attempt: a
    // timeout or a reset mid-body is classified like one before headers.
    let status = 0;
    let retryAfter: string | null = null;
    let text: string;
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]) : AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
      status = res.status;
      retryAfter = res.headers.get("retry-after");
      text = await res.text();
    } catch (err) {
      if (signal?.aborted) throw err;
      const timedOut = err instanceof Error && (err.name === "TimeoutError" || err.name === "AbortError");
      // Headers said 5xx but the body never came: still that HTTP failure.
      const failure: AttemptFailure = timedOut
        ? { kind: "timeout" }
        : status >= 500
          ? { kind: "http", status, retryAfter }
          : { kind: "network" };
      throw new AttemptError(
        failure,
        new OpenRouterError(
          `OpenRouter ${path} ${timedOut ? "timed out" : "network error"}: ${err instanceof Error ? err.message : err}`,
          status,
          failure
        )
      );
    }
    if (status < 200 || status >= 300) {
      const failure: AttemptFailure = { kind: "http", status, retryAfter };
      throw new AttemptError(
        failure,
        new OpenRouterError(`OpenRouter ${path} failed (${status}): ${text.slice(0, 500)}`, status, failure)
      );
    }
    try {
      return JSON.parse(text) as T;
    } catch {
      // Not retried: a 200 with an unreadable body is not a transient error.
      throw new InvalidResponseError(`OpenRouter ${path} returned a body that isn't JSON`);
    }
  });
}

type EmbeddingsResponse = {
  data: { embedding: number[]; index?: number }[];
  usage?: { cost?: number };
};

function assertEmbeddingShape(vector: number[] | undefined): number[] {
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape: got ${vector?.length ?? "none"} dimensions, expected ${EMBEDDING_DIMENSIONS}`
    );
  }
  return vector;
}

// OpenRouter always includes the real billed cost in `usage.cost` on every
// response now (the old `usage: { include: true }` request flag is
// deprecated and has no effect) -- no separate pricing table to keep in
// sync, and this is the actual charge, not an estimate.
export async function embed(
  text: string,
  { retry = "none" }: { retry?: RetryPolicy } = {}
): Promise<{ vector: number[]; costUsd: number; retries: number }> {
  const { vectors, costUsd, retries } = await embedMany([text], { retry });
  return { vector: vectors[0], costUsd, retries };
}

// One request for a whole note's chunks (the embeddings endpoint takes an
// array input) rather than one round-trip per chunk. Results come back in
// input order; `index` is honoured anyway in case a provider reorders.
export async function embedMany(
  texts: string[],
  { retry = "none" }: { retry?: RetryPolicy } = {}
): Promise<{ vectors: number[][]; costUsd: number; retries: number }> {
  if (texts.length === 0) {
    return { vectors: [], costUsd: 0, retries: 0 };
  }
  const { value: res, retries } = await post<EmbeddingsResponse>("/embeddings", {
    model: EMBEDDING_MODEL,
    input: texts,
    // Ticket text and staff notes are customer data, often PII: never route
    // to a provider that may retain or train on inputs.
    provider: { data_collection: "deny" },
  }, retry);
  const data = res.data ?? [];
  if (data.length !== texts.length) {
    throw new Error(`Expected ${texts.length} embeddings, got ${data.length}`);
  }
  const vectors: (number[] | undefined)[] = new Array(texts.length).fill(undefined);
  data.forEach((item, position) => {
    const slot = item.index ?? position;
    if (!Number.isInteger(slot) || slot < 0 || slot >= texts.length || vectors[slot]) {
      throw new Error(`Embedding response has an out-of-range or duplicate index (${slot})`);
    }
    vectors[slot] = assertEmbeddingShape(item.embedding);
  });
  if (vectors.some((vector) => vector === undefined)) {
    throw new Error("Embedding response left an input without a vector");
  }
  return { vectors: vectors as number[][], costUsd: res.usage?.cost ?? 0, retries };
}

export type JsonSchema = Record<string, unknown>;

export type Usage = { prompt_tokens: number; completion_tokens: number; cost_usd: number };

type ChatCompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: Partial<Usage> & { cost?: number };
};

// Structured output: `strict: true` makes the provider enforce the schema,
// and `provider.require_parameters` stops OpenRouter from silently routing
// to a provider that would ignore response_format.
export async function completeJson<T>(opts: {
  system: string;
  user: string;
  schemaName: string;
  schema: JsonSchema;
  maxTokens: number;
  retry?: RetryPolicy;
  signal?: AbortSignal;
}): Promise<{ data: T; usage: Usage; model: string; retries: number }> {
  const { value: res, retries } = await post<ChatCompletionResponse>("/chat/completions", {
    model: TRIAGE_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
    // require_parameters: never route to a provider that would ignore the
    // schema. data_collection deny: never route to one that may retain or
    // train on the ticket text (customer data, often PII).
    provider: { require_parameters: true, data_collection: "deny" },
    max_tokens: opts.maxTokens,
    temperature: 0.2,
  }, opts.retry ?? "none", opts.signal);

  const content = res.choices?.[0]?.message?.content;
  if (!content) {
    throw new InvalidResponseError("OpenRouter returned an empty completion");
  }

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new InvalidResponseError("OpenRouter returned non-JSON content despite json_schema response_format");
  }

  return {
    data,
    usage: {
      prompt_tokens: res.usage?.prompt_tokens ?? 0,
      completion_tokens: res.usage?.completion_tokens ?? 0,
      cost_usd: res.usage?.cost ?? 0,
    },
    model: res.model ?? TRIAGE_MODEL,
    retries,
  };
}

// OpenAI-compatible tool calling, which is what OpenRouter speaks for every
// provider. The model returns `tool_calls`; the caller runs them and feeds
// each result back as a `tool` message, then asks for the next turn.
export type ToolDefinition = {
  type: "function";
  function: { name: string; description: string; parameters: JsonSchema };
};

export type ToolCall = {
  id: string;
  type: "function";
  function: { name: string; arguments: string };
};

export type ChatMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: ToolCall[] }
  | { role: "tool"; tool_call_id: string; content: string };

type ChatCompletionWithToolsResponse = {
  model?: string;
  choices?: { message?: { content?: string | null; tool_calls?: ToolCall[] } }[];
  usage?: Partial<Usage> & { cost?: number };
};

// Free-form multi-turn completion for the staff assistant chat: unlike
// completeJson, this takes a full message history (the caller is
// responsible for memory) and returns plain text -- no response_format
// lock, so any chat-capable model on OpenRouter works here. When `tools`
// are supplied the model may answer with tool calls instead of (or as well
// as) text; the caller decides what to do with them.
export async function completeChat(opts: {
  messages: ChatMessage[];
  model?: string;
  maxTokens?: number;
  tools?: ToolDefinition[];
  // "required": the model must call a tool this round (OpenRouter maps it
  // to each provider's equivalent, e.g. Anthropic's "any").
  toolChoice?: "auto" | "none" | "required";
}): Promise<{ text: string; toolCalls: ToolCall[]; usage: Usage; model: string }> {
  const withTools = Boolean(opts.tools && opts.tools.length > 0);
  // Sage is interactive: never retried automatically (SUP-32); a failure
  // shows the chat's "couldn't respond" message and the person asks again.
  const { value: res } = await post<ChatCompletionWithToolsResponse>("/chat/completions", {
    model: opts.model ?? ASSISTANT_MODEL,
    messages: opts.messages,
    ...(withTools ? { tools: opts.tools, tool_choice: opts.toolChoice ?? "auto" } : {}),
    // Staff may paste ticket/customer text into the assistant, so the same
    // no-retention stance as triage applies here. require_parameters (only
    // when tools are in play): never route to a provider that would
    // silently drop the tool definitions and answer without them.
    provider: { data_collection: "deny", ...(withTools ? { require_parameters: true } : {}) },
    max_tokens: opts.maxTokens ?? 1024,
  }, "none");

  const message = res.choices?.[0]?.message;
  const text = message?.content ?? "";
  // Every field the tool loop later relies on is checked here, so a
  // malformed call from a provider can't turn into a `tool` message with
  // an undefined id (which the next request would reject with a 400).
  const toolCalls = (message?.tool_calls ?? []).filter(
    (call): call is ToolCall =>
      typeof call?.id === "string" &&
      call.type === "function" &&
      typeof call.function?.name === "string" &&
      typeof call.function.arguments === "string"
  );
  if (!text && toolCalls.length === 0) {
    throw new Error("OpenRouter returned an empty completion");
  }

  return {
    text,
    toolCalls,
    usage: {
      prompt_tokens: res.usage?.prompt_tokens ?? 0,
      completion_tokens: res.usage?.completion_tokens ?? 0,
      cost_usd: res.usage?.cost ?? 0,
    },
    model: res.model ?? (opts.model ?? ASSISTANT_MODEL),
  };
}
