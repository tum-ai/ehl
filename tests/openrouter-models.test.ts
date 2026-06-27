import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// fetchAvailableModels powers the admin code-review model dropdown. It must only
// offer models usable for code review: they take a text prompt and return text.
// Pure image/audio/embedding-OUTPUT models (which OpenRouter also lists) must be
// dropped, but anything text-capable (incl. multimodal image+text) must stay.
vi.mock("@/lib/settings", () => ({
  getSettingValue: vi.fn().mockResolvedValue("test-key"),
  SETTING_KEYS: { OPENROUTER_API_KEY: "openrouter_api_key" },
}));

import { fetchAvailableModels } from "@/lib/code-review/openrouter";

const ORIGINAL_FETCH = global.fetch;

function mockModels(models: unknown[]) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => ({ data: models }),
  }) as unknown as typeof fetch;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => {
  global.fetch = ORIGINAL_FETCH;
});

describe("fetchAvailableModels", () => {
  it("keeps text-output models and drops pure image/embedding-output models", async () => {
    mockModels([
      {
        id: "anthropic/claude-sonnet-4.5",
        name: "Claude Sonnet 4.5",
        pricing: { prompt: "0", completion: "0" },
        context_length: 200000,
        architecture: { input_modalities: ["text"], output_modalities: ["text"] },
      },
      {
        id: "google/gemini-3.1-flash-image",
        name: "Gemini Flash Image",
        pricing: { prompt: "0", completion: "0" },
        context_length: 100000,
        // multimodal: outputs image AND text -> still usable for code review
        architecture: { input_modalities: ["text", "image"], output_modalities: ["image", "text"] },
      },
      {
        id: "some/pure-image-gen",
        name: "Pure Image Gen",
        pricing: { prompt: "0", completion: "0" },
        context_length: 4096,
        // outputs ONLY image -> cannot do code review -> dropped
        architecture: { input_modalities: ["text"], output_modalities: ["image"] },
      },
      {
        id: "some/embeddings",
        name: "Embeddings",
        pricing: { prompt: "0", completion: "0" },
        context_length: 8192,
        architecture: { input_modalities: ["text"], output_modalities: ["embedding"] },
      },
    ]);

    const result = await fetchAvailableModels();
    const ids = result.map((m) => m.id);
    expect(ids).toContain("anthropic/claude-sonnet-4.5");
    expect(ids).toContain("google/gemini-3.1-flash-image"); // text-capable -> kept
    expect(ids).not.toContain("some/pure-image-gen");
    expect(ids).not.toContain("some/embeddings");
  });

  it("drops zero-context models", async () => {
    mockModels([
      {
        id: "ok/model",
        name: "OK",
        pricing: { prompt: "0", completion: "0" },
        context_length: 1000,
        architecture: { output_modalities: ["text"] },
      },
      {
        id: "bad/zero-context",
        name: "Zero",
        pricing: { prompt: "0", completion: "0" },
        context_length: 0,
        architecture: { output_modalities: ["text"] },
      },
    ]);
    const ids = (await fetchAvailableModels()).map((m) => m.id);
    expect(ids).toContain("ok/model");
    expect(ids).not.toContain("bad/zero-context");
  });

  it("fails OPEN: a model with no architecture field is kept (schema change safety)", async () => {
    mockModels([
      {
        id: "no/architecture",
        name: "No Arch",
        pricing: { prompt: "0", completion: "0" },
        context_length: 8000,
        // architecture omitted entirely
      },
    ]);
    const ids = (await fetchAvailableModels()).map((m) => m.id);
    expect(ids).toContain("no/architecture");
  });
});
