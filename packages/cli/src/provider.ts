// Provider configuration for the CLI: same env-var conventions as the
// web app, with --provider / --model / --base-url flag overrides.

import { providerFromConfig, type LLMProvider } from "@verric/core";

export interface CliProviderOptions {
  provider?: string;
  model?: string;
  apiKey?: string;
  baseUrl?: string;
}

export function buildProvider(opts: CliProviderOptions): LLMProvider {
  const id = (opts.provider || process.env.VERRIC_PROVIDER || "").toLowerCase();
  let apiKey: string | undefined;
  let model: string | undefined = opts.model;
  let baseUrl: string | undefined = opts.baseUrl;
  let provider: "openai" | "anthropic" | "ollama" | undefined;

  if (id === "openai") {
    provider = "openai";
    apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    model = model ?? process.env.OPENAI_MODEL;
    baseUrl = baseUrl ?? process.env.OPENAI_BASE_URL;
  } else if (id === "anthropic") {
    provider = "anthropic";
    apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    model = model ?? process.env.ANTHROPIC_MODEL;
    baseUrl = baseUrl ?? process.env.ANTHROPIC_BASE_URL;
  } else if (id === "ollama") {
    provider = "ollama";
    model = model ?? process.env.OLLAMA_MODEL;
    baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL;
  } else if (process.env.OPENAI_API_KEY || opts.apiKey) {
    provider = "openai";
    apiKey = opts.apiKey ?? process.env.OPENAI_API_KEY;
    model = model ?? process.env.OPENAI_MODEL;
  } else {
    provider = "ollama";
    model = model ?? process.env.OLLAMA_MODEL;
    baseUrl = baseUrl ?? process.env.OLLAMA_BASE_URL;
  }

  return providerFromConfig({ provider, apiKey, model, baseUrl });
}
