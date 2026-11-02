# OpenRouter APIs — Deepgram: Flux TTS (deepgram/flux-tts)

Guide for calling every confirmed OpenRouter API that serves `deepgram/flux-tts`.

Model page: https://openrouter.ai/deepgram/flux-tts
Create an API key: https://openrouter.ai/settings/keys

## EU in-region routing

`deepgram/flux-tts` is not currently available through EU in-region routing.

Docs: https://openrouter.ai/docs/guides/features/in-region-routing

## Authentication

Send this header with every request:

- Authorization: Bearer $OPENROUTER_API_KEY

## Text-to-Speech API

Synthesize audio with `deepgram/flux-tts` through OpenRouter's Text-to-Speech API.

Docs: https://openrouter.ai/docs/api/api-reference/tts/create-speech

### Endpoint

POST https://openrouter.ai/api/v1/audio/speech

Headers:
- Content-Type: application/json

### Request fields (deepgram/flux-tts)

- model: string (required) — `"deepgram/flux-tts"`
- input: string (required) — text to synthesize
- voice: "flux-alexis-en" | "flux-bree-en" | "flux-brittany-en" | "flux-brooke-en" | "flux-bruce-en" | "flux-cliff-en" | "flux-cole-en" | "flux-colin-en" | "flux-conor-en" | "flux-donovan-en" | "flux-drew-en" | "flux-elise-en" | "flux-gemma-en" | "flux-haley-en" | "flux-hannah-en" | "flux-heather-en" | "flux-jack-en" | "flux-kai-en" | "flux-kelsey-en" | "flux-kit-en" | "flux-maeve-en" | "flux-marcelo-en" | "flux-marcus-en" | "flux-meena-en" | "flux-meghan-en" | "flux-miles-en" | "flux-naveen-en" | "flux-paige-en" | "flux-priya-en" | "flux-rufus-en" | "flux-sean-en" | "flux-sharon-en" | "flux-sienna-en" | "flux-tanner-en" | "flux-wade-en" | "flux-wes-en" (optional) — provider-specific voice identifier
- response_format: "mp3" | "pcm" (optional) — output audio encoding; defaults to pcm

### Response

Success returns raw audio bytes, not JSON.

- `Content-Type` identifies the audio encoding, such as `audio/mpeg` or `audio/pcm`.
- `X-Generation-Id` identifies the billed generation.
- Write the response body directly to an audio file; do not call `response.json()`.

### Examples

#### Synthesize speech

```bash
curl https://openrouter.ai/api/v1/audio/speech \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $OPENROUTER_API_KEY" \
  --output output.pcm \
  -d '{
  "model": "deepgram/flux-tts",
  "input": "Hello! This is a text-to-speech test.",
  "voice": "flux-alexis-en"
}'
```

### Error differences

- 400 — malformed audio input or an audio option the routed provider does not support
- 502 — the upstream audio operation failed

## Errors

Failures return `{"error": {"code": <number>, "message": <string>}}` with the HTTP status:

- 400 — malformed request or an unsupported parameter
- 401 — missing or invalid API key
- 402 — insufficient credits
- 403 — spend limit reached, key disabled, or access blocked
- 404 — unknown model or no provider can serve the request
- 429 — rate limited; retry with backoff
- 502 — the operation failed upstream; failed generations are not billed

---

Canonical version of this document: https://openrouter.ai/deepgram/flux-tts/llms.txt
