import { audioContextCtor } from "./dictation.js";

const TICK_MS = 50;
/** Well above the reply that leaks through echo cancellation, well below a voice at the mic. */
const VOICE_RMS = 0.08;
/** A cough or a click is shorter; the first syllables of a sentence are longer. */
const VOICE_SUSTAIN_MS = 300;

/**
 * Meters the echo-cancelled microphone while a reply plays and calls `onVoice` once the
 * caller has been talking for a moment. It records nothing: the turn that follows opens its
 * own recording, so the reply's audio never reaches transcription. Resolves false when this
 * browser cannot meter the microphone.
 */
export async function watchForVoice(onVoice: () => void, signal: AbortSignal): Promise<boolean> {
  const Ctor = audioContextCtor();
  if (!Ctor || !navigator.mediaDevices?.getUserMedia || signal.aborted) return false;
  let stream: MediaStream;
  try {
    stream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
    });
  } catch {
    return false;
  }
  const release = (ctx?: AudioContext, timer?: ReturnType<typeof setInterval>) => {
    clearInterval(timer);
    for (const track of stream.getTracks()) track.stop();
    if (ctx) void ctx.close().catch(() => undefined);
  };
  if (signal.aborted) {
    release();
    return true;
  }
  let ctx: AudioContext;
  try {
    ctx = new Ctor();
  } catch {
    release();
    return false;
  }
  const analyser = ctx.createAnalyser();
  analyser.fftSize = 1024;
  ctx.createMediaStreamSource(stream).connect(analyser);
  if (ctx.state === "suspended") void ctx.resume();
  const data = new Uint8Array(analyser.fftSize);
  let loudFor = 0;
  const timer = setInterval(() => {
    analyser.getByteTimeDomainData(data);
    let sum = 0;
    for (const sample of data) {
      const n = (sample - 128) / 128;
      sum += n * n;
    }
    loudFor = Math.sqrt(sum / data.length) > VOICE_RMS ? loudFor + TICK_MS : 0;
    if (loudFor < VOICE_SUSTAIN_MS) return;
    release(ctx, timer);
    onVoice();
  }, TICK_MS);
  signal.addEventListener("abort", () => release(ctx, timer), { once: true });
  return true;
}
