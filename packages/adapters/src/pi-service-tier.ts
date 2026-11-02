/** xAI Grok models that accept OpenAI Responses `service_tier: fast` on subscription OAuth. */
export const XAI_FAST_TIER_MODEL_IDS = new Set(["grok-4.6", "grok-4.7"]);

export function staticCatalogSupportsFastTier(provider: string, modelId: string): boolean {
  return provider === "xai" && XAI_FAST_TIER_MODEL_IDS.has(modelId);
}

/** Wire value for pi-ai stream options when the bot's fast toggle is on. */
export function runServiceTier(modelFastTier: boolean | null | undefined): "fast" | undefined {
  return modelFastTier ? "fast" : undefined;
}
