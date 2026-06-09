// LLM provider abstraction. Bring-your-own-key, provider-agnostic.
//
// All providers conform to the same minimal interface:
//   generate(prompt) → text
//
// The engine never invents results: if the provider call fails or returns
// unparseable output (after one repair retry), runReport throws — no mock
// fallback. That's the trust contract.

export type LLMRole = "system" | "user" | "assistant";

export interface LLMMessage {
  role: LLMRole;
  content: string;
}

export interface LLMRequest {
  messages: LLMMessage[];
  /** 0..1, where supported. Lower = more deterministic. */
  temperature?: number;
  /** Hint to the provider; not all honor it. */
  maxTokens?: number;
  /** When true, ask the provider to constrain to JSON output if supported. */
  jsonMode?: boolean;
}

export interface LLMUsage {
  inputTokens?: number;
  outputTokens?: number;
}

export interface LLMResponse {
  text: string;
  /** Provider-reported model identifier; recorded in receipts for reproducibility. */
  model: string;
  usage?: LLMUsage;
}

export interface LLMProvider {
  /** Stable ID like "openai", "anthropic", "ollama". Recorded in receipts. */
  readonly id: string;
  /** Default model the provider was configured with. Recorded in receipts. */
  readonly model: string;
  generate(req: LLMRequest): Promise<LLMResponse>;
}

export class LLMProviderError extends Error {
  constructor(
    message: string,
    public readonly providerId: string,
    public readonly status?: number,
    public readonly cause?: unknown
  ) {
    super(message);
    this.name = "LLMProviderError";
  }
}

// ─────────────────────────────────────────────────────────────────────────
// OpenAI (chat.completions, JSON mode)
// ─────────────────────────────────────────────────────────────────────────

export interface OpenAIProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createOpenAIProvider(opts: OpenAIProviderOptions): LLMProvider {
  const model = opts.model ?? "gpt-4o-mini";
  const baseUrl = opts.baseUrl ?? "https://api.openai.com/v1";
  const fx = opts.fetch ?? fetch;
  return {
    id: "openai",
    model,
    async generate(req) {
      const body = {
        model,
        messages: req.messages,
        temperature: req.temperature ?? 0.15,
        max_tokens: req.maxTokens ?? 5200,
        ...(req.jsonMode ? { response_format: { type: "json_object" } } : {})
      };
      const res = await fx(`${baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${opts.apiKey}`,
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMProviderError(
          `OpenAI request failed (${res.status}): ${text.slice(0, 400)}`,
          "openai",
          res.status
        );
      }
      const data = (await res.json()) as {
        choices?: Array<{ message?: { content?: string } }>;
        model?: string;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      const text = data.choices?.[0]?.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new LLMProviderError("OpenAI returned empty content", "openai");
      }
      return {
        text,
        model: data.model ?? model,
        usage: {
          inputTokens: data.usage?.prompt_tokens,
          outputTokens: data.usage?.completion_tokens
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Anthropic (messages API)
// ─────────────────────────────────────────────────────────────────────────

export interface AnthropicProviderOptions {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  fetch?: typeof fetch;
}

export function createAnthropicProvider(opts: AnthropicProviderOptions): LLMProvider {
  const model = opts.model ?? "claude-3-5-sonnet-latest";
  const baseUrl = opts.baseUrl ?? "https://api.anthropic.com/v1";
  const fx = opts.fetch ?? fetch;
  return {
    id: "anthropic",
    model,
    async generate(req) {
      // Anthropic separates the system prompt from the message list.
      const systemMessages = req.messages.filter((m) => m.role === "system").map((m) => m.content);
      const userMessages = req.messages.filter((m) => m.role !== "system");
      const body = {
        model,
        max_tokens: req.maxTokens ?? 5200,
        temperature: req.temperature ?? 0.15,
        ...(systemMessages.length > 0 ? { system: systemMessages.join("\n\n") } : {}),
        messages: userMessages.map((m) => ({ role: m.role, content: m.content }))
      };
      const res = await fx(`${baseUrl}/messages`, {
        method: "POST",
        headers: {
          "x-api-key": opts.apiKey,
          "anthropic-version": "2023-06-01",
          "Content-Type": "application/json"
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMProviderError(
          `Anthropic request failed (${res.status}): ${text.slice(0, 400)}`,
          "anthropic",
          res.status
        );
      }
      const data = (await res.json()) as {
        content?: Array<{ type?: string; text?: string }>;
        model?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };
      const text = data.content?.find((p) => p.type === "text")?.text;
      if (typeof text !== "string" || text.length === 0) {
        throw new LLMProviderError("Anthropic returned empty content", "anthropic");
      }
      return {
        text,
        model: data.model ?? model,
        usage: {
          inputTokens: data.usage?.input_tokens,
          outputTokens: data.usage?.output_tokens
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Ollama (local, OpenAI-compatible chat endpoint)
// ─────────────────────────────────────────────────────────────────────────

export interface OllamaProviderOptions {
  /** Default: http://127.0.0.1:11434 */
  baseUrl?: string;
  /** Default: llama3.1 */
  model?: string;
  fetch?: typeof fetch;
}

export function createOllamaProvider(opts: OllamaProviderOptions = {}): LLMProvider {
  const model = opts.model ?? "llama3.1";
  const baseUrl = opts.baseUrl ?? "http://127.0.0.1:11434";
  const fx = opts.fetch ?? fetch;
  return {
    id: "ollama",
    model,
    async generate(req) {
      // Ollama's /api/chat endpoint speaks the OpenAI-ish shape.
      const body = {
        model,
        messages: req.messages,
        stream: false,
        options: {
          temperature: req.temperature ?? 0.15,
          num_predict: req.maxTokens ?? 5200
        },
        ...(req.jsonMode ? { format: "json" } : {})
      };
      const res = await fx(`${baseUrl}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new LLMProviderError(
          `Ollama request failed (${res.status}): ${text.slice(0, 400)}`,
          "ollama",
          res.status
        );
      }
      const data = (await res.json()) as {
        message?: { content?: string };
        model?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };
      const text = data.message?.content;
      if (typeof text !== "string" || text.length === 0) {
        throw new LLMProviderError("Ollama returned empty content", "ollama");
      }
      return {
        text,
        model: data.model ?? model,
        usage: {
          inputTokens: data.prompt_eval_count,
          outputTokens: data.eval_count
        }
      };
    }
  };
}

// ─────────────────────────────────────────────────────────────────────────
// Provider selection from environment / config
// ─────────────────────────────────────────────────────────────────────────

export interface ProviderConfig {
  provider?: "openai" | "anthropic" | "ollama";
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

/**
 * Build a provider from a config object. Throws a clear error when the
 * required key for the chosen provider is missing — no silent fallback.
 */
export function providerFromConfig(cfg: ProviderConfig): LLMProvider {
  const id = cfg.provider ?? (cfg.apiKey ? "openai" : "ollama");
  if (id === "openai") {
    if (!cfg.apiKey) {
      throw new LLMProviderError(
        "OpenAI selected but no API key supplied (set OPENAI_API_KEY or pick a different provider).",
        "openai"
      );
    }
    return createOpenAIProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
  }
  if (id === "anthropic") {
    if (!cfg.apiKey) {
      throw new LLMProviderError(
        "Anthropic selected but no API key supplied (set ANTHROPIC_API_KEY or pick a different provider).",
        "anthropic"
      );
    }
    return createAnthropicProvider({ apiKey: cfg.apiKey, model: cfg.model, baseUrl: cfg.baseUrl });
  }
  if (id === "ollama") {
    return createOllamaProvider({ model: cfg.model, baseUrl: cfg.baseUrl });
  }
  throw new LLMProviderError(`Unknown provider: ${String(id)}`, String(id));
}
