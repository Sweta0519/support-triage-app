import "server-only";

// Thin fetch wrappers over OpenRouter's REST API. Server-only: this module
// is the only place OPENROUTER_API_KEY is ever read.

const BASE_URL = "https://openrouter.ai/api/v1";

// OpenRouter slugs use dotted versions ("4.5"), unlike Anthropic's own
// hyphenated ids. Haiku 4.5 rather than Sonnet 4.6: this workspace's
// OpenRouter guardrail blocks Sonnet-tier endpoints (GET /api/v1/models/user
// lists what the key may actually use), and closed-schema classification is
// squarely Haiku's job. Switching models is a one-line change here.
export const TRIAGE_MODEL = "anthropic/claude-haiku-4.5";
export const EMBEDDING_MODEL = "openai/text-embedding-3-small";
// Must match ticketing.ticket_embeddings.embedding's vector(1536). Never
// change one without the other -- and never change the embedding model at
// all after setup without re-embedding every row.
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
    readonly status: number
  ) {
    super(message);
    this.name = "OpenRouterError";
  }
}

// One retry on 429/5xx, then give up -- the caller marks the ticket
// `failed` and a human can re-run. Retrying harder here just burns money
// during an outage.
async function post<T>(path: string, body: unknown): Promise<T> {
  let lastError: unknown;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(`${BASE_URL}${path}`, {
        method: "POST",
        headers: authHeaders(),
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });

      if (res.ok) {
        return (await res.json()) as T;
      }

      const text = await res.text();
      const err = new OpenRouterError(
        `OpenRouter ${path} failed (${res.status}): ${text.slice(0, 500)}`,
        res.status
      );
      const retryable = res.status === 429 || res.status >= 500;
      if (!retryable) {
        throw err;
      }
      lastError = err;
    } catch (err) {
      if (err instanceof OpenRouterError && err.status < 500 && err.status !== 429) {
        throw err;
      }
      lastError = err;
    }
  }
  throw lastError instanceof Error ? lastError : new Error("OpenRouter request failed");
}

type EmbeddingsResponse = {
  data: { embedding: number[] }[];
};

export async function embed(text: string): Promise<number[]> {
  const res = await post<EmbeddingsResponse>("/embeddings", {
    model: EMBEDDING_MODEL,
    input: text,
  });
  const vector = res.data?.[0]?.embedding;
  if (!Array.isArray(vector) || vector.length !== EMBEDDING_DIMENSIONS) {
    throw new Error(
      `Unexpected embedding shape: got ${vector?.length ?? "none"} dimensions, expected ${EMBEDDING_DIMENSIONS}`
    );
  }
  return vector;
}

export type JsonSchema = Record<string, unknown>;

export type Usage = { prompt_tokens: number; completion_tokens: number };

type ChatCompletionResponse = {
  model?: string;
  choices?: { message?: { content?: string | null } }[];
  usage?: Partial<Usage>;
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
}): Promise<{ data: T; usage: Usage; model: string }> {
  const res = await post<ChatCompletionResponse>("/chat/completions", {
    model: TRIAGE_MODEL,
    messages: [
      { role: "system", content: opts.system },
      { role: "user", content: opts.user },
    ],
    response_format: {
      type: "json_schema",
      json_schema: { name: opts.schemaName, strict: true, schema: opts.schema },
    },
    provider: { require_parameters: true },
    max_tokens: opts.maxTokens,
    temperature: 0.2,
  });

  const content = res.choices?.[0]?.message?.content;
  if (!content) {
    throw new Error("OpenRouter returned an empty completion");
  }

  let data: T;
  try {
    data = JSON.parse(content) as T;
  } catch {
    throw new Error("OpenRouter returned non-JSON content despite json_schema response_format");
  }

  return {
    data,
    usage: {
      prompt_tokens: res.usage?.prompt_tokens ?? 0,
      completion_tokens: res.usage?.completion_tokens ?? 0,
    },
    model: res.model ?? TRIAGE_MODEL,
  };
}
