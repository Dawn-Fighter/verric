import { describe, expect, it, vi } from "vitest";
import {
  LLMProviderError,
  createAnthropicProvider,
  createOllamaProvider,
  createOpenAIProvider,
  providerFromConfig
} from "./providers";

// Provider adapters are network-edge code. Tests use a fake fetch so we
// can lock the request shape, response handling, and error paths without
// hitting real APIs.

function fakeFetch(handler: (url: string, init: RequestInit) => Response | Promise<Response>) {
  return vi.fn(async (url: string | URL, init?: RequestInit) =>
    handler(String(url), init ?? {})
  ) as unknown as typeof fetch;
}

describe("OpenAI provider", () => {
  it("posts to /chat/completions with bearer auth and parses content", async () => {
    const fx = fakeFetch(async (url, init) => {
      expect(url).toBe("https://api.openai.com/v1/chat/completions");
      const headers = init.headers as Record<string, string>;
      expect(headers.Authorization).toBe("Bearer test-key");
      expect(headers["Content-Type"]).toBe("application/json");
      const body = JSON.parse(String(init.body));
      expect(body.model).toBe("gpt-4o-mini");
      expect(body.response_format).toEqual({ type: "json_object" });
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"hello":"world"}' } }],
          model: "gpt-4o-mini-2024-07-18",
          usage: { prompt_tokens: 10, completion_tokens: 5 }
        }),
        { status: 200 }
      );
    });
    const p = createOpenAIProvider({ apiKey: "test-key", fetch: fx });
    const out = await p.generate({
      messages: [{ role: "user", content: "hi" }],
      jsonMode: true
    });
    expect(out.text).toBe('{"hello":"world"}');
    expect(out.model).toBe("gpt-4o-mini-2024-07-18");
    expect(out.usage).toEqual({ inputTokens: 10, outputTokens: 5 });
  });

  it("throws LLMProviderError on a non-2xx response (no silent fallback)", async () => {
    const fx = fakeFetch(async () => new Response("rate limited", { status: 429 }));
    const p = createOpenAIProvider({ apiKey: "x", fetch: fx });
    await expect(p.generate({ messages: [{ role: "user", content: "hi" }] })).rejects.toBeInstanceOf(
      LLMProviderError
    );
  });

  it("throws when the response payload has no content", async () => {
    const fx = fakeFetch(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 }));
    const p = createOpenAIProvider({ apiKey: "x", fetch: fx });
    await expect(p.generate({ messages: [] })).rejects.toThrow(/empty content/);
  });
});

describe("Anthropic provider", () => {
  it("splits system messages from user messages and posts /messages", async () => {
    const fx = fakeFetch(async (url, init) => {
      expect(url).toBe("https://api.anthropic.com/v1/messages");
      const body = JSON.parse(String(init.body));
      expect(body.system).toBe("You are a helper.");
      expect(body.messages).toEqual([{ role: "user", content: "do the thing" }]);
      return new Response(
        JSON.stringify({
          content: [{ type: "text", text: "ok" }],
          model: "claude-3-5-sonnet-20240620",
          usage: { input_tokens: 12, output_tokens: 3 }
        }),
        { status: 200 }
      );
    });
    const p = createAnthropicProvider({ apiKey: "k", fetch: fx });
    const out = await p.generate({
      messages: [
        { role: "system", content: "You are a helper." },
        { role: "user", content: "do the thing" }
      ]
    });
    expect(out.text).toBe("ok");
    expect(out.model).toBe("claude-3-5-sonnet-20240620");
    expect(out.usage).toEqual({ inputTokens: 12, outputTokens: 3 });
  });
});

describe("Ollama provider", () => {
  it("targets the local /api/chat endpoint and reads message.content", async () => {
    const fx = fakeFetch(async (url, init) => {
      expect(url).toBe("http://127.0.0.1:11434/api/chat");
      const body = JSON.parse(String(init.body));
      expect(body.format).toBe("json");
      expect(body.stream).toBe(false);
      return new Response(
        JSON.stringify({
          message: { content: "{}" },
          model: "llama3.1",
          prompt_eval_count: 50,
          eval_count: 8
        }),
        { status: 200 }
      );
    });
    const p = createOllamaProvider({ fetch: fx });
    const out = await p.generate({ messages: [{ role: "user", content: "hi" }], jsonMode: true });
    expect(out.text).toBe("{}");
    expect(out.usage).toEqual({ inputTokens: 50, outputTokens: 8 });
  });
});

describe("providerFromConfig — no silent fallback", () => {
  it("throws when openai is selected without an API key", () => {
    expect(() => providerFromConfig({ provider: "openai" })).toThrow(LLMProviderError);
  });

  it("throws when anthropic is selected without an API key", () => {
    expect(() => providerFromConfig({ provider: "anthropic" })).toThrow(LLMProviderError);
  });

  it("returns ollama when no provider/key is given (local-first default)", () => {
    const p = providerFromConfig({});
    expect(p.id).toBe("ollama");
  });

  it("returns openai when a key is given without an explicit provider", () => {
    const p = providerFromConfig({ apiKey: "k" });
    expect(p.id).toBe("openai");
  });

  it("throws on an unknown provider id", () => {
    // @ts-expect-error — testing runtime validation
    expect(() => providerFromConfig({ provider: "nope" })).toThrow(LLMProviderError);
  });
});
