import { getSettingValue, SETTING_KEYS } from "@/lib/settings";

const OPENROUTER_BASE = "https://openrouter.ai/api/v1";

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface ChatCompletionParams {
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  max_tokens?: number;
}

interface ChatCompletionResult {
  content: string;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_cost: number;
  };
}

export interface OpenRouterModel {
  id: string;
  name: string;
  pricing: { prompt: string; completion: string };
  context_length: number;
}

async function getApiKey(): Promise<string> {
  const key = await getSettingValue(
    SETTING_KEYS.OPENROUTER_API_KEY,
    process.env.OPENROUTER_API_KEY
  );
  if (!key) throw new Error("OpenRouter API key not configured. Set it in Admin > Settings.");
  return key;
}

async function withRetry<T>(
  fn: () => Promise<T>,
  maxAttempts = 3
): Promise<T> {
  let lastError: Error | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e instanceof Error ? e : new Error(String(e));
      if (attempt < maxAttempts - 1) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

export async function chatCompletion(
  params: ChatCompletionParams
): Promise<ChatCompletionResult> {
  const apiKey = await getApiKey();

  return withRetry(async () => {
    const res = await fetch(`${OPENROUTER_BASE}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        "HTTP-Referer": process.env.NEXT_PUBLIC_SITE_URL || "https://ehl.gg",
        "X-Title": "EHL Code Review",
      },
      body: JSON.stringify({
        model: params.model,
        messages: params.messages,
        temperature: params.temperature ?? 0,
        max_tokens: params.max_tokens ?? 4096,
      }),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`OpenRouter API error ${res.status}: ${text}`);
    }

    const data = await res.json();
    const choice = data.choices?.[0];
    if (!choice?.message?.content) {
      throw new Error("No content in OpenRouter response");
    }

    // Calculate cost from usage
    const usage = data.usage ?? {};
    const promptTokens = usage.prompt_tokens ?? 0;
    const completionTokens = usage.completion_tokens ?? 0;
    const totalCost = usage.total_cost ?? data.usage?.cost ?? 0;

    return {
      content: choice.message.content,
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_cost: typeof totalCost === "number" ? totalCost : 0,
      },
    };
  });
}

export async function fetchAvailableModels(): Promise<OpenRouterModel[]> {
  const apiKey = await getApiKey();

  const res = await fetch(`${OPENROUTER_BASE}/models`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch models: ${res.status}`);
  }

  const data = await res.json();
  const models = (data.data ?? []) as Array<{
    id: string;
    name: string;
    pricing: { prompt: string; completion: string };
    context_length: number;
    architecture?: {
      input_modalities?: string[];
      output_modalities?: string[];
    };
  }>;

  // Only offer models that are actually usable for code review: they must accept
  // a text PROMPT and return TEXT (the pipeline sends text and parses a text/JSON
  // reply). This drops image/audio/embedding output models (e.g.
  // google/gemini-*-image, *-tts, embeddings) that OpenRouter also lists but that
  // would fail at review time. When OpenRouter omits the architecture field we
  // keep the model (fail-open) so a schema change can't empty the list.
  return models
    .filter((m) => m.context_length > 0)
    .filter((m) => {
      const arch = m.architecture;
      if (!arch) return true; // unknown shape — don't hide it
      const inputs = arch.input_modalities;
      const outputs = arch.output_modalities;
      const acceptsText = !inputs || inputs.includes("text");
      const returnsText = !outputs || outputs.includes("text");
      return acceptsText && returnsText;
    })
    .map((m) => ({
      id: m.id,
      name: m.name,
      pricing: m.pricing,
      context_length: m.context_length,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}
