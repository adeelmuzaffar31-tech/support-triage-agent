import { RetryableError } from "./retry.ts";
import type { Config } from "./config.ts";

export interface ChatMessage {
  role: "user" | "assistant";
  content: string;
}

/** Minimal provider-agnostic interface: system prompt + transcript in, text out. */
export interface LLMClient {
  readonly name: string;
  complete(system: string, messages: ChatMessage[]): Promise<string>;
}

function retryableStatus(status: number): boolean {
  return status === 408 || status === 409 || status === 429 || status >= 500;
}

async function postJson(url: string, headers: Record<string, string>, body: unknown): Promise<any> {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(60_000),
    });
  } catch (e) {
    // Network failures and timeouts are worth retrying.
    throw new RetryableError(`Network error calling ${url}: ${(e as Error).message}`);
  }
  if (!res.ok) {
    const text = await res.text();
    const msg = `${url} returned ${res.status}: ${text.slice(0, 300)}`;
    if (retryableStatus(res.status)) throw new RetryableError(msg, res.status);
    throw new Error(msg);
  }
  return res.json();
}

export class AnthropicClient implements LLMClient {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string) {
    this.name = `anthropic:${model}`;
  }

  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      { "x-api-key": this.apiKey, "anthropic-version": "2023-06-01" },
      { model: this.model, max_tokens: 800, temperature: 0, system, messages },
    );
    const text = (data.content ?? [])
      .filter((b: { type: string }) => b.type === "text")
      .map((b: { text: string }) => b.text)
      .join("");
    if (!text) throw new RetryableError("Empty response from Anthropic");
    return text;
  }
}

export class OpenAIClient implements LLMClient {
  readonly name: string;
  constructor(private readonly apiKey: string, private readonly model: string) {
    this.name = `openai:${model}`;
  }

  async complete(system: string, messages: ChatMessage[]): Promise<string> {
    const data = await postJson(
      "https://api.openai.com/v1/chat/completions",
      { authorization: `Bearer ${this.apiKey}` },
      {
        model: this.model,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [{ role: "system", content: system }, ...messages],
      },
    );
    const text = data.choices?.[0]?.message?.content;
    if (!text) throw new RetryableError("Empty response from OpenAI");
    return text;
  }
}

export function createLLM(config: Config): LLMClient {
  if (config.LLM_PROVIDER === "openai") {
    if (!config.OPENAI_API_KEY) throw new Error("OPENAI_API_KEY is not set (see .env.example)");
    return new OpenAIClient(config.OPENAI_API_KEY, config.LLM_MODEL ?? "gpt-4o-mini");
  }
  if (!config.ANTHROPIC_API_KEY) throw new Error("ANTHROPIC_API_KEY is not set (see .env.example)");
  return new AnthropicClient(config.ANTHROPIC_API_KEY, config.LLM_MODEL ?? "claude-haiku-4-5-20251001");
}
