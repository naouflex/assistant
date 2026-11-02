import { afterEach, describe, expect, it, vi } from "vitest";
import {
  DEFAULT_OPENROUTER_STT_MODEL,
  DEFAULT_OPENROUTER_TTS_MODEL,
  DEFAULT_OPENROUTER_FISH_VOICE_ID,
  OPENROUTER_DEFAULT_VOICE_ID,
  OpenRouterVoiceProvider,
  parseOpenRouterVoiceSecret,
  serializeOpenRouterVoiceSecret,
} from "./openrouter-voice.js";

const context = {
  operationId: "voice",
  traceId: "voice",
  spaceId: "space-1",
  userId: "user-1",
  signal: new AbortController().signal,
};

const secret = serializeOpenRouterVoiceSecret({
  apiKey: "sk-or-test-key",
  ttsModel: "hexgrad/kokoro-82m",
  sttModel: "nvidia/nemotron-3.5-transcribe",
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
});

describe("OpenRouter voice secret", () => {
  it("stores the key and models, and fills the defaults when models are blank", () => {
    expect(parseOpenRouterVoiceSecret(secret)).toEqual({
      kind: "openrouter",
      apiKey: "sk-or-test-key",
      ttsModel: "hexgrad/kokoro-82m",
      sttModel: "nvidia/nemotron-3.5-transcribe",
    });
    expect(DEFAULT_OPENROUTER_TTS_MODEL).toBe("fish-audio/s2.1-pro-free:free");
    expect(
      parseOpenRouterVoiceSecret(serializeOpenRouterVoiceSecret({ apiKey: "sk-or-test-key" })),
    ).toEqual({
      kind: "openrouter",
      apiKey: "sk-or-test-key",
      ttsModel: "fish-audio/s2.1-pro-free:free",
      sttModel: DEFAULT_OPENROUTER_STT_MODEL,
    });
  });

  it("keeps the stored key and models when a reconnect leaves them blank", () => {
    const next = serializeOpenRouterVoiceSecret({ apiKey: "  " }, secret);
    expect(parseOpenRouterVoiceSecret(next).apiKey).toBe("sk-or-test-key");
    expect(parseOpenRouterVoiceSecret(next).sttModel).toBe("nvidia/nemotron-3.5-transcribe");
  });

  it("rejects a missing key and a model id that cannot be sent", () => {
    expect(() => serializeOpenRouterVoiceSecret({ apiKey: "short" })).toThrow(/Enter an API key/);
    expect(() =>
      serializeOpenRouterVoiceSecret({ apiKey: "sk-or-test-key", ttsModel: "has space" }),
    ).toThrow(/Speech model id is not valid/);
  });
});

describe("OpenRouterVoiceProvider", () => {
  const provider = new OpenRouterVoiceProvider();

  it("checks the key and does not follow a redirect", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider.verify(secret, context)).resolves.toEqual({ ok: true });
    expect(fetchMock).toHaveBeenCalledWith(
      "https://openrouter.ai/api/v1/key",
      expect.objectContaining({ redirect: "error" }),
    );
    const headers = new Headers(fetchMock.mock.calls[0]?.[1].headers);
    expect(headers.get("authorization")).toBe("Bearer sk-or-test-key");
    expect(headers.get("x-title")).toBe("Atlas");
  });

  it("lists the speech model's voices and a default when it has none", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        data: [
          { id: "other/model", supported_voices: ["nope"] },
          { id: "hexgrad/kokoro-82m", supported_voices: ["af_heart", "bm_george"] },
        ],
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    await expect(provider.listVoices(secret, context)).resolves.toEqual([
      { id: "af_heart", label: "af_heart" },
      { id: "bm_george", label: "bm_george" },
    ]);

    const fish = serializeOpenRouterVoiceSecret({ apiKey: "sk-or-test-key" });
    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ id: "fish-audio/s2.1-pro-free:free", supported_voices: null }],
      }),
    );
    await expect(provider.listVoices(fish, context)).resolves.toEqual(
      expect.arrayContaining([
        { id: DEFAULT_OPENROUTER_FISH_VOICE_ID, label: "Selene" },
        { id: "9a9cf47702da476aa4629e2506d4a857", label: "Hannah" },
      ]),
    );

    fetchMock.mockResolvedValueOnce(
      Response.json({
        data: [{ id: "fish-audio/s2.1-pro-free:free", supported_voices: ["default"] }],
      }),
    );
    await expect(provider.listVoices(fish, context)).resolves.toEqual(
      expect.arrayContaining([{ id: DEFAULT_OPENROUTER_FISH_VOICE_ID, label: "Selene" }]),
    );
  });

  it("speaks MP3 with the saved model and omits a default voice", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(new Uint8Array([1, 2, 3]), {
        status: 200,
        headers: { "content-type": "audio/mpeg" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const clip = await provider.synthesize(
      { apiKey: secret, voiceId: "af_heart", text: "Hello" },
      context,
    );
    expect(clip).toMatchObject({ mimeType: "audio/mpeg", bytes: new Uint8Array([1, 2, 3]) });
    expect(JSON.parse(fetchMock.mock.calls[0]?.[1].body)).toEqual({
      model: "hexgrad/kokoro-82m",
      input: "Hello",
      response_format: "mp3",
      voice: "af_heart",
    });

    const fish = serializeOpenRouterVoiceSecret({ apiKey: "sk-or-test-key" });
    await provider.synthesize(
      { apiKey: fish, voiceId: OPENROUTER_DEFAULT_VOICE_ID, text: "Hello" },
      context,
    );
    expect(JSON.parse(fetchMock.mock.calls[1]?.[1].body)).toEqual({
      model: "fish-audio/s2.1-pro-free:free",
      input: "Hello",
      response_format: "mp3",
      voice: DEFAULT_OPENROUTER_FISH_VOICE_ID,
    });
  });

  it("refuses audio this app cannot play", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(new Uint8Array([1]), {
          status: 200,
          headers: { "content-type": "audio/pcm" },
        }),
      ),
    );
    await expect(
      provider.synthesize({ apiKey: secret, voiceId: "af_heart", text: "Hello" }, context),
    ).rejects.toThrow(/did not return MP3 audio/);
  });

  it("transcribes with the saved model", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        Response.json(
          { text: " status please " },
          { headers: { "content-type": "application/json" } },
        ),
      );
    vi.stubGlobal("fetch", fetchMock);
    await expect(
      provider.transcribe(
        {
          apiKey: secret,
          audio: new Uint8Array([1, 2]),
          mimeType: "audio/webm",
          language: "en-US",
        },
        context,
      ),
    ).resolves.toEqual({ text: "status please" });
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "https://openrouter.ai/api/v1/audio/transcriptions",
    );
    const body = fetchMock.mock.calls[0]?.[1].body as FormData;
    expect(body.get("model")).toBe("nvidia/nemotron-3.5-transcribe");
    expect(body.get("language")).toBe("en");
    expect(body.get("file")).toBeInstanceOf(Blob);
  });
});
