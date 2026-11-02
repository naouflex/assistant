import type { Api, Model, MutableModels } from "@earendil-works/pi-ai";

/** Grok Build / SuperGrok OAuth id for Composer 2.5 Fast; not on pay-per-token API keys. */
export const XAI_COMPOSER_25_MODEL_ID = "grok-composer-2.5-fast";

const XAI_COMPOSER_25: Model<Api> = {
  id: XAI_COMPOSER_25_MODEL_ID,
  name: "Composer 2.5 Fast",
  api: "openai-responses",
  provider: "xai",
  baseUrl: "https://api.x.ai/v1",
  compat: {
    supportsLongCacheRetention: false,
  },
  reasoning: false,
  input: ["text", "image"],
  cost: {
    input: 0.5,
    output: 2.5,
    cacheRead: 0.2,
    cacheWrite: 0,
  },
  contextWindow: 256_000,
  maxTokens: 256_000,
  inputLimits: {
    images: {
      resize: {
        maxWidth: 2000,
        maxHeight: 2000,
        maxBytes: 4_718_592,
        jpegQuality: 80,
      },
    },
  },
  type: "chat",
};

/** Register Composer 2.5 on xAI when pi-ai's bundled registry has not caught up yet. */
export function registerXaiComposerModel(models: MutableModels): MutableModels {
  const provider = models.getProvider?.("xai");
  if (!provider) return models;
  const existing = provider.getModels();
  if (existing.some((model) => model.id === XAI_COMPOSER_25_MODEL_ID)) return models;
  models.setProvider({
    ...provider,
    getModels: () => [...existing, XAI_COMPOSER_25],
  });
  return models;
}
