import { DEFAULT_MODEL_CONTEXT_WINDOW } from "@atlas/contracts";
import type { Api, Model, Models } from "@earendil-works/pi-ai";

/** Models endpoints often mix chat models with tools and media endpoints. */
export function isChatModelId(id: string): boolean {
  return (
    /^[\x21-\x7e]{1,1024}$/.test(id) &&
    !/(embed|(?:^|[-/_])tts(?:[-/_]|$)|whisper|transcrib|audio|realtime|dall-e|gpt-image|imagen|moderation|rerank|stable-diffusion|\bflux\b|image|text-to-speech|speech-to-text|\bsora\b|\bveo\b|video|\bocr\b|davinci|babbage|turbo-instruct|computer-use)/i.test(
      id,
    )
  );
}

/**
 * The account catalog's image answer replaces whatever modalities were guessed.
 * An absent answer leaves them alone, including the text-only cross-family fallback.
 */
export function withLiveImageInput(
  model: Model<Api>,
  supportsImages: boolean | undefined,
): Model<Api> {
  if (supportsImages === undefined) return model;
  const input: Model<Api>["input"] = supportsImages ? ["text", "image"] : ["text"];
  if (
    model.input.length === input.length &&
    input.every((modality, index) => model.input[index] === modality)
  ) {
    return model;
  }
  return { ...model, input };
}

/** The id without a date or alias suffix: `x-model-2026-01-31` and `x-model-latest` are `x-model`. */
function modelFamily(value: string): string {
  return value.replace(/-(?:\d{4}-\d{2}-\d{2}|\d{4,8}|latest)$/, "");
}

/**
 * The id without its trailing version number: `vendor/name-5.2` and `vendor/name-5.1` are one
 * line. A catalog that predates a point release still knows that line's modalities, reasoning
 * and window; treating the newer release as an unrelated model turned off its thinking, cut its
 * output cap to the plain default and hid its image input.
 */
function modelLine(value: string): string {
  return modelFamily(value).replace(/-\d+(?:\.\d+)*$/, "");
}

/** A date or alias variant, or another point release of the same named line. */
export function sameModelLine(id: string, other: string): boolean {
  if (modelFamily(id) === modelFamily(other)) return true;
  const line = modelLine(id);
  // A bare version (`vendor/7`) names no line to share.
  return (
    line !== modelFamily(id) &&
    /[A-Za-z]/.test(line.split("/").pop() ?? "") &&
    line === modelLine(other)
  );
}

function sharedPrefixLength(a: string, b: string): number {
  let n = 0;
  while (n < a.length && a[n] === b[n]) n++;
  return n;
}

/**
 * The cataloged release of the same line on this provider, whatever wire API it speaks: a
 * newer point release is served the same way as the one before it. Ties go to the closest id.
 */
function closestLineSibling(models: Models, provider: string, id: string): Model<Api> | undefined {
  const candidates =
    models
      .getProvider?.(provider)
      ?.getModels()
      .filter((model) => !model.id.includes(":") && sameModelLine(id, model.id)) ?? [];
  const best = [...candidates].sort(
    (a, b) =>
      sharedPrefixLength(id, b.id) - sharedPrefixLength(id, a.id) || a.id.localeCompare(b.id),
  )[0];
  if (!best) return undefined;
  const url = new URL(best.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || /[{}]/.test(url.href))
    return undefined;
  return best;
}

/** A deterministic fallback shared by listing and execution; never changes provider or host. */
export function liveModelSibling(
  models: Models,
  provider: string,
  id: string,
): Model<Api> | undefined {
  if (!isChatModelId(id)) return undefined;
  const lineSibling = closestLineSibling(models, provider, id);
  if (lineSibling) return { ...lineSibling, id, name: id };
  const siblings =
    models
      .getProvider?.(provider)
      ?.getModels()
      .filter((model) =>
        ["openai-completions", "openai-responses", "openai-codex-responses"].includes(model.api),
      ) ?? [];
  const urls = new Set(siblings.map((model) => model.baseUrl));
  if (urls.size !== 1 || siblings.length === 0) return undefined;
  const url = new URL(siblings[0]!.baseUrl);
  if (url.protocol !== "https:" || url.username || url.password || /[{}]/.test(url.href))
    return undefined;
  const prefixLength = (other: string) => {
    let n = 0;
    while (n < id.length && id[n] === other[n]) n++;
    return n;
  };
  const sibling = [...siblings].sort((a, b) => prefixLength(b.id) - prefixLength(a.id))[0]!;
  const sameFamily = sameModelLine(id, sibling.id);
  return {
    ...sibling,
    id,
    name: id,
    reasoning: sameFamily && sibling.reasoning,
    input: sameFamily ? [...sibling.input] : ["text"],
    // An unrelated sibling's window says nothing about this model's.
    contextWindow: sameFamily ? sibling.contextWindow : DEFAULT_MODEL_CONTEXT_WINDOW,
  };
}
