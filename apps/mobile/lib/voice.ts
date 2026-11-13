import type { SettingsScope } from "@atlas/contracts";
import {
  ensureAiDataConsent,
  readVoiceAudio,
  readVoiceError,
  requestDeadline,
  toUtterances,
  VOICE_RESPONSE_TIMEOUT_MS,
  withAbort,
} from "@atlas/core";
import { createAudioPlayer, setAudioModeAsync } from "expo-audio";
import { File, Paths } from "expo-file-system";
import type * as ExpoSpeech from "expo-speech";
import { Platform } from "react-native";
import { promptAiConsent } from "./ai-consent";
import type { ApiRequestContext } from "./api";
import { aiConsentCoalesceKey, captureApiRequestContext, rpc } from "./api";
import { voiceForBot } from "./bot-voices";
import { loadDeviceVoiceEnabled } from "./device-voice";
import { t } from "./i18n";
import {
  acquireSpeechFocus,
  createPlaybackKeeper,
  keepPlaybackInBackground,
  onPlaybackStopRequested,
  onSpeechFocusChange,
  releaseSpeechFocus,
  speechFocusSupported,
} from "./playback-background";
import { fetchServer } from "./server-headers";
import { errorText, voiceAccountErrorText } from "./user-error";

/** Who is speaking, for the dock: it is mounted outside any one thread's bot list. */
export type PlaybackSpeaker = { name?: string; color?: string };
/** Who started a speech, so their Stop call reaches only their own playback. */
export type SpeechOwner = symbol;

/** A unique owner for the speech one surface is about to start, e.g. the current call. */
export function createSpeechOwner(): SpeechOwner {
  return Symbol("SpeechOwner");
}

type SpeechOptions = {
  /** Which copy of the voice settings to use; omitted means whichever applies in the space. */
  scope?: SettingsScope;
  voiceId?: string;
  botId?: string;
  messageId?: string;
  speaker?: PlaybackSpeaker;
  /** Tags this speech for its starter, so stopSpeaking(owner) cuts only this playback. */
  owner?: SpeechOwner;
};

// Playback status lets a persistent mini-player show and control what's speaking, without every
// screen re-deriving state from the speak calls below.

export type VoicePlaybackStatus = "idle" | "playing" | "paused";
export type VoicePlaybackState = {
  status: VoicePlaybackStatus;
  botId?: string;
  /** The thread message this clip was spoken from, when playback started from one. */
  messageId?: string;
  /** False while the clip is still being prepared, before there is anything to pause. */
  canPause: boolean;
  speaker?: PlaybackSpeaker;
  /** Paused by a phone call or another app taking the audio, not by the user. */
  interrupted?: true;
  /** More queued speech follows, so Skip can move on to it. */
  canSkip?: true;
};
type VoiceControl = {
  pause(): void;
  resume(): void;
  stop(): void;
  /** Ends the current message only, so a queue moves on to the next one. */
  skip?(): void;
};

const IDLE_PLAYBACK: VoicePlaybackState = { status: "idle", canPause: false };
let playback: VoicePlaybackState = IDLE_PLAYBACK;
let activeControl: VoiceControl | null = null;
const playbackListeners = new Set<() => void>();

// The speaker is remembered per bot rather than threaded through every state
// change below: pause, resume and the device-voice path all rebuild the state.
let announcedSpeaker: { botId: string; speaker: PlaybackSpeaker } | undefined;

/** Set while a call or another app holds the audio; "lost" waits for the user to resume. */
let interruption: "transient" | "lost" | null = null;

function setPlayback(next: VoicePlaybackState, control: VoiceControl | null) {
  if (next.status === "idle") interruption = null;
  const speaker =
    next.botId && announcedSpeaker?.botId === next.botId ? announcedSpeaker.speaker : undefined;
  playback = withQueueState({
    ...next,
    ...(speaker ? { speaker } : {}),
    ...(next.status === "paused" && interruption ? { interrupted: true as const } : {}),
  });
  activeControl = control;
  for (const listener of playbackListeners) listener();
  // A call holds its own microphone service; anything else read aloud holds a playback one,
  // so locking the phone or switching apps does not cut the reply off.
  keepPlaybackInBackground(
    playback.status !== "idle" && !playsInBackground,
    playback.speaker?.name,
  );
  // The audio is held for the whole reply, across its clips, and let go when the user pauses
  // so their music comes back. An interruption keeps the request, to hear when it ends.
  speechFocus.update(
    !playsInBackground &&
      (playback.status === "playing" ||
        (playback.status === "paused" && interruption === "transient")),
  );
}

function withQueueState(state: VoicePlaybackState): VoicePlaybackState {
  const { canSkip: _drop, ...rest } = state;
  return state.status !== "idle" && speechQueue.length > 0 ? { ...rest, canSkip: true } : rest;
}

/** Re-announces the dock's state when only the queue behind it changed. */
function refreshQueueState(): void {
  const next = withQueueState(playback);
  if (next.canSkip === playback.canSkip) return;
  playback = next;
  for (const listener of playbackListeners) listener();
}

export function getVoicePlaybackState(): VoicePlaybackState {
  return playback;
}

export function subscribeVoicePlayback(listener: () => void): () => void {
  playbackListeners.add(listener);
  return () => playbackListeners.delete(listener);
}

export function pauseVoicePlayback(): void {
  activeControl?.pause();
}

export function resumeVoicePlayback(): void {
  // Resuming after another app took the audio for good asks for it again.
  if (interruption === "lost") speechFocus.reacquire();
  interruption = null;
  activeControl?.resume();
}

export function stopVoicePlayback(): void {
  // Bump even when nothing is audible yet. The next queued message may already
  // be preparing, with no player for Stop to reach.
  playbackEpoch += 1;
  speechQueue = [];
  activeControl?.stop();
}

/** Moves on to the next queued message, or stops when this was the last one. */
export function skipVoicePlayback(): void {
  if (speechQueue.length === 0 || !activeControl?.skip) {
    stopVoicePlayback();
    return;
  }
  activeControl.skip();
}

/**
 * A call or another app took the audio: pause the reply where it is. "transient" resumes on its
 * own when the audio comes back; "lost" (another app started playing) waits for the user.
 */
export function interruptVoicePlayback(kind: "transient" | "lost"): void {
  if (playback.status === "idle" || !activeControl) return;
  if (playback.status === "paused" && interruption === null) return; // the user paused first
  interruption = kind;
  // While the clip is still preparing there is nothing to pause yet; it starts paused instead.
  if (playback.status === "playing" && playback.canPause) activeControl.pause();
  else setPlayback(playback, activeControl);
}

/** The audio came back after a transient interruption. */
export function endVoiceInterruption(): void {
  if (interruption !== "transient") return;
  interruption = null;
  if (playback.status === "paused") activeControl?.resume();
}

/** A reply that became playable during a call starts paused, and resumes when the call ends. */
function applyPendingInterruption(control: VoiceControl): void {
  if (interruption !== null && playback.status === "playing" && activeControl === control) {
    control.pause();
  }
}

/** Cuts the reply off mid-sentence, for a caller who talked over it. */
export function stopSpeaking(owner?: SpeechOwner): void {
  // An owner's stop reaches only its own speech: a hang-up must not cut unrelated
  // playback that has since replaced it.
  if (owner !== undefined && activeSpeechOwner !== owner) return;
  stopVoicePlayback();
}

/** True while a call is up: its replies share the call's recording session and service. */
let playsInBackground = false;

/**
 * Audio mode for whatever is about to play. A reply keeps playing when the app leaves the
 * screen: the user stops it from the dock or the notification, not by locking the phone.
 * A call stays a recording session: switching to playback-only while a reply plays drops
 * the microphone, and it stays dropped once the app leaves.
 */
function playbackAudioMode() {
  return {
    playsInSilentMode: true as const,
    interruptionMode: replyInterruptionMode(),
    shouldPlayInBackground: true as const,
    ...(playsInBackground ? { allowsRecording: true as const } : {}),
  };
}

/**
 * Replies duck other audio. Android does that through the reply-long focus request below, so
 * expo-audio must not also take and drop focus per clip (music would swell between sentences);
 * iOS ducks through the audio session. A call keeps mixing, as its recording session needs.
 */
function replyInterruptionMode(): "mixWithOthers" | "duckOthers" {
  if (playsInBackground) return "mixWithOthers";
  if (Platform.OS === "android") return speechFocusSupported() ? "mixWithOthers" : "duckOthers";
  return Platform.OS === "ios" ? "duckOthers" : "mixWithOthers";
}

/**
 * A call keeps its replies playing while the screen is off; the microphone
 * foreground service is what keeps the app alive then. The recording session
 * is applied immediately so leaving the app before the first reply still holds
 * the microphone.
 */
export function setVoiceBackgroundPlayback(enabled: boolean): void {
  playsInBackground = enabled;
  keepPlaybackInBackground(playback.status !== "idle" && !enabled, playback.speaker?.name);
  void setAudioModeAsync(playbackAudioMode()).catch(() => undefined);
}

// Queued playback runs speakText one call at a time, so a single Stop always reaches whatever is
// actually playing right now.

export type SpeechQueueItem = SpeechOptions & { text: string };

let speechQueue: SpeechQueueItem[] = [];
/** Invalidates in-flight speak calls. Stop and a new speak or queue each bump it. */
let playbackEpoch = 0;
/** The owner of the speech holding the current epoch, replaced as each new speech begins. */
let activeSpeechOwner: SpeechOwner | undefined;

function isCurrentSpeech(epoch: number): boolean {
  return epoch === playbackEpoch;
}

function beginSpeech(owner?: SpeechOwner): number {
  playbackEpoch += 1;
  speechQueue = [];
  // Own the epoch before the first await, so a stale owner cannot stop this preparation.
  activeSpeechOwner = owner;
  // Replacing activeControl leaves the previous player running.
  activeControl?.stop();
  return playbackEpoch;
}

function releasePlayback(epoch: number, stillOwner: boolean, keepForQueue: boolean): void {
  if (!stillOwner || !isCurrentSpeech(epoch)) return;
  // The next queued message is about to prepare. Idle here hides the dock for that gap.
  if (keepForQueue && speechQueue.length > 0) return;
  setPlayback(IDLE_PLAYBACK, null);
}

/**
 * Speaks each item in order; stops early if stopVoicePlayback() clears the
 * queue. Resolves to whether the first item was spoken, so a caller can tell
 * the user when no voice is set up.
 */
export async function speakQueue(items: SpeechQueueItem[], owner?: SpeechOwner): Promise<boolean> {
  const epoch = beginSpeech(owner);
  speechQueue = items.map((item) => (owner && !item.owner ? { ...item, owner } : item));
  return advanceSpeechQueue(epoch);
}

/** The epoch of the queue an owner is still playing, so more of its speech can join it. */
let queueOwner: { owner: SpeechOwner; epoch: number } | undefined;

/**
 * Adds speech to the end of what `owner` is already saying, e.g. the next sentences of a reply
 * that is still streaming in; starts speaking when it has gone quiet. Resolves true once the
 * speech joined a running queue or has played, or false when nothing could be spoken (no voice).
 */
export async function appendSpeech(items: SpeechQueueItem[], owner: SpeechOwner): Promise<boolean> {
  if (items.length === 0) return true;
  const owned = items.map((item) => ({ ...item, owner }));
  for (const item of owned) streamedItems.add(item);
  if (queueOwner?.owner === owner && isCurrentSpeech(queueOwner.epoch)) {
    speechQueue.push(...owned);
    refreshQueueState();
    if (lastClip?.epoch === queueOwner.epoch) prefetchNextQueued(lastClip.requestContext);
    return true;
  }
  const epoch = beginSpeech(owner);
  queueOwner = { owner, epoch };
  speechQueue = owned;
  try {
    let spoken = await advanceSpeechQueue(epoch);
    // Speech that joined while the last item finished still gets its turn.
    while (spoken && isCurrentSpeech(epoch) && speechQueue.length > 0) {
      spoken = await advanceSpeechQueue(epoch);
    }
    return spoken;
  } finally {
    if (queueOwner?.epoch === epoch) queueOwner = undefined;
  }
}

async function advanceSpeechQueue(epoch: number): Promise<boolean> {
  // A newer Play or Stop owns the outcome. False would look like "no voice".
  if (!isCurrentSpeech(epoch)) return true;
  const next = speechQueue.shift();
  if (!next) return false;
  refreshQueueState();
  const { text, ...opts } = next;
  const spoken = await speakPrepared(text, opts, epoch, next);
  if (!isCurrentSpeech(epoch)) return true;
  if (spoken && speechQueue.length > 0) await advanceSpeechQueue(epoch);
  return spoken;
}

export async function speakText(text: string, opts: SpeechOptions = {}): Promise<boolean> {
  return speakPrepared(text, opts, beginSpeech(opts.owner));
}

async function speakPrepared(
  text: string,
  opts: SpeechOptions,
  epoch: number,
  item?: SpeechQueueItem,
): Promise<boolean> {
  if (!isCurrentSpeech(epoch)) return false;
  // Each queued item owns the epoch while it prepares and plays.
  activeSpeechOwner = opts.owner;
  announcedSpeaker =
    opts.botId && opts.speaker ? { botId: opts.botId, speaker: opts.speaker } : undefined;
  // Stop has to work before a player exists. Pause stays hidden until one does.
  const prepareControl: VoiceControl = {
    pause() {},
    resume() {},
    stop() {
      setPlayback(IDLE_PLAYBACK, null);
    },
  };
  setPlayback(
    { status: "playing", botId: opts.botId, messageId: opts.messageId, canPause: false },
    prepareControl,
  );
  try {
    let useDeviceVoice = false;
    try {
      useDeviceVoice = await loadDeviceVoiceEnabled();
    } catch {
      // A read failure must not be treated as "off": that would send reply text
      // through hosted voice after the user opted for on-device only.
      useDeviceVoice = true;
    }
    if (!isCurrentSpeech(epoch)) return false;
    if (useDeviceVoice) {
      const spoken = await speakOnDevice(text, opts.botId, opts.messageId, epoch);
      if (!isCurrentSpeech(epoch)) return false;
      if (!spoken && playback.status !== "idle") setPlayback(IDLE_PLAYBACK, null);
      return spoken;
    }
    const requestContext = await captureApiRequestContext();
    if (!isCurrentSpeech(epoch)) return false;
    const plan = await ((item && prefetchedPlans.get(item)) ??
      planHostedSpeech(text, opts, requestContext));
    if (item) prefetchedPlans.delete(item);
    if (!isCurrentSpeech(epoch)) return false;
    if (!plan.ready) {
      if (playback.status !== "idle") setPlayback(IDLE_PLAYBACK, null);
      return false;
    }

    const generation = startHostedSpeechSession();
    // The prepare control only owns the dock; stopping it would hide Stop.
    if (activeControl !== prepareControl) activeControl?.stop();
    if (!isCurrentSpeech(epoch)) return false;
    const session = new HostedSession(generation);
    let skipped = false;
    const control: VoiceControl = {
      pause: () => {
        session.pause();
        setPlayback(
          { status: "paused", botId: opts.botId, messageId: opts.messageId, canPause: true },
          control,
        );
      },
      resume: () => {
        session.resume();
        setPlayback(
          { status: "playing", botId: opts.botId, messageId: opts.messageId, canPause: true },
          control,
        );
      },
      stop: () => {
        session.stop();
        setPlayback(IDLE_PLAYBACK, null);
      },
      skip: () => {
        skipped = true;
        session.stop();
      },
    };
    setPlayback(
      { status: "playing", botId: opts.botId, messageId: opts.messageId, canPause: true },
      control,
    );
    applyPendingInterruption(control);
    const utterances = plan.utterances;
    const render = (clip: string): Promise<Rendered> => renderSafely(clip, opts, requestContext);
    let finished = false;
    try {
      // Render one clip ahead; the first may already be rendering from the plan.
      let next: Promise<Rendered> | null =
        utterances.length > 0 ? (plan.first ?? render(utterances[0] ?? "")) : null;
      for (let i = 0; i < utterances.length; i += 1) {
        if (session.isStopped || !isCurrentSpeech(epoch)) break;
        const current = next;
        next = i + 1 < utterances.length ? render(utterances[i + 1] ?? "") : null;
        // The last clip is playing: get the next queued message ready behind it.
        if (i + 1 === utterances.length) {
          lastClip = { epoch, requestContext };
          prefetchNextQueued(requestContext);
        }
        if (!current) break;
        const rendered = await current;
        if ("error" in rendered) throw rendered.error;
        if (session.isStopped || !isCurrentSpeech(epoch)) break;
        await playSpeechClip(rendered.audio, session);
      }
      finished = (!session.isStopped || skipped) && isCurrentSpeech(epoch);
    } finally {
      if (lastClip?.epoch === epoch) lastClip = null;
      releasePlayback(epoch, isCurrentHostedSpeechSession(generation) || skipped, finished);
    }
    return true;
  } finally {
    // A thrown or abandoned prepare must not leave the dock up. A newer Play
    // has already replaced this control.
    if (isCurrentSpeech(epoch) && activeControl === prepareControl) {
      setPlayback(IDLE_PLAYBACK, null);
    }
  }
}

// Failures ride as values, so an abandoned prefetch never rejects unhandled.
type Rendered = { audio: Uint8Array; error?: never } | { audio?: never; error: unknown };
type HostedPlan = { ready: boolean; utterances: string[]; first?: Promise<Rendered> };

function renderSafely(
  text: string,
  opts: SpeechOptions,
  requestContext: ApiRequestContext,
): Promise<Rendered> {
  return renderUtterance(text, opts, requestContext).then(
    (audio) => ({ audio }),
    (error: unknown) => ({ error }),
  );
}

/** What to say: the server may shorten a long reply to a summary written by the bot's model. */
async function planHostedSpeech(
  text: string,
  opts: SpeechOptions,
  requestContext: ApiRequestContext,
): Promise<HostedPlan> {
  const prepared = await rpc(
    "voice/prepare",
    { text, voiceId: opts.voiceId, botId: opts.botId, scope: opts.scope },
    { requestContext },
  );
  return { ready: prepared.ready, utterances: prepared.ready ? prepared.utterances : [] };
}

/** The first clip of a queued message, rendering while the message before it still plays. */
async function planWithFirstClip(
  text: string,
  opts: SpeechOptions,
  requestContext: ApiRequestContext,
): Promise<HostedPlan> {
  const plan = await planHostedSpeech(text, opts, requestContext);
  const opening = plan.utterances[0];
  return plan.ready && opening
    ? { ...plan, first: renderSafely(opening, opts, requestContext) }
    : plan;
}

const prefetchedPlans = new WeakMap<SpeechQueueItem, Promise<HostedPlan>>();

/** The hosted reply playing its last clip, so speech that joins now is readied at once. */
let lastClip: { epoch: number; requestContext: ApiRequestContext } | null = null;

/** Speech added to a reply that is still streaming; the next of it is readied ahead. */
const streamedItems = new WeakSet<SpeechQueueItem>();

/**
 * Plans the next streamed chunk, and renders its first clip, while the current one plays its last
 * clip, so the voice runs on without a gap. A queue of whole messages waits its turn instead:
 * a Stop there would waste the render.
 */
function prefetchNextQueued(requestContext: ApiRequestContext): void {
  const upcoming = speechQueue[0];
  if (!upcoming || !streamedItems.has(upcoming) || prefetchedPlans.has(upcoming)) return;
  const { text, ...opts } = upcoming;
  const plan = planWithFirstClip(text, opts, requestContext);
  // Its failure surfaces when the queue reaches it, not as an unhandled rejection now.
  plan.catch(() => undefined);
  prefetchedPlans.set(upcoming, plan);
}

let deviceSpeechSession = 0;

function startDeviceSpeechSession(): number {
  return ++deviceSpeechSession;
}

function isCurrentDeviceSpeechSession(session: number): boolean {
  return session === deviceSpeechSession;
}

export async function speakWithDeviceVoice(
  text: string,
  botId?: string,
  messageId?: string,
): Promise<boolean> {
  return speakOnDevice(text, botId, messageId);
}

async function speakOnDevice(
  text: string,
  botId?: string,
  messageId?: string,
  epoch?: number,
): Promise<boolean> {
  const utterances = toUtterances(text);
  if (utterances.length === 0) return false;
  const mine = epoch ?? beginSpeech();
  if (!isCurrentSpeech(mine)) return false;
  // Claim the session before importing so a newer call cannot start during
  // that await and then overlap this call's remaining chunks.
  const session = startDeviceSpeechSession();
  const Speech = await loadExpoSpeech();
  // Each bot keeps its own offline voice; without one the engine's default speaks.
  const voice = botId ? await voiceForBot(botId).catch(() => undefined) : undefined;
  if (!isCurrentDeviceSpeechSession(session) || !isCurrentSpeech(mine)) return true;
  await Speech.stop();
  if (!isCurrentDeviceSpeechSession(session) || !isCurrentSpeech(mine)) return true;

  // iOS's engine pauses mid-word. Android's TextToSpeech can only stop, so a pause there stops
  // the sentence and Resume says it again from its start. Feature-detect the native pause:
  // support has moved across expo-speech versions, and a missing method must not throw here.
  const pausable = Speech as unknown as {
    pause?: () => void | Promise<void>;
    resume?: () => void | Promise<void>;
  };
  const nativePause =
    Platform.OS === "ios" &&
    typeof pausable.pause === "function" &&
    typeof pausable.resume === "function";
  if (!isCurrentDeviceSpeechSession(session) || !isCurrentSpeech(mine)) return true;
  let paused = false;
  let skipped = false;
  let wake: (() => void) | undefined;
  const waitWhilePaused = () =>
    new Promise<void>((resolve) => {
      wake = resolve;
    });
  const control: VoiceControl = {
    pause: () => {
      if (paused) return;
      paused = true;
      if (nativePause) void pausable.pause?.();
      else void Speech.stop();
      setPlayback({ status: "paused", botId, messageId, canPause: true }, control);
    },
    resume: () => {
      if (!paused) return;
      paused = false;
      if (nativePause) void pausable.resume?.();
      wake?.();
      setPlayback({ status: "playing", botId, messageId, canPause: true }, control);
    },
    stop: () => {
      deviceSpeechSession += 1;
      void Speech.stop();
      wake?.();
      setPlayback(IDLE_PLAYBACK, null);
    },
    skip: () => {
      skipped = true;
      deviceSpeechSession += 1;
      void Speech.stop();
      wake?.();
    },
  };
  setPlayback({ status: "playing", botId, messageId, canPause: true }, control);
  applyPendingInterruption(control);
  const current = () => isCurrentDeviceSpeechSession(session) && isCurrentSpeech(mine);
  let finished = false;
  try {
    for (let i = 0; i < utterances.length; ) {
      if (!current()) return true;
      if (paused && !nativePause) {
        await waitWhilePaused();
        continue;
      }
      await speakOneUtterance(Speech, utterances[i] ?? "", voice);
      // Stopped by a pause: the same sentence is spoken again on Resume.
      if (paused && !nativePause) continue;
      i += 1;
    }
    finished = current();
    return true;
  } finally {
    releasePlayback(mine, isCurrentDeviceSpeechSession(session) || skipped, finished || skipped);
  }
}

async function loadExpoSpeech(): Promise<typeof ExpoSpeech> {
  let Speech: Partial<typeof ExpoSpeech>;
  try {
    Speech = await import("expo-speech");
  } catch (error) {
    throw error instanceof Error ? error : new Error(t("Could not play that clip."));
  }
  if (typeof Speech.speak !== "function" || typeof Speech.stop !== "function") {
    throw new Error(t("Could not play that clip."));
  }
  return Speech as typeof ExpoSpeech;
}

function speakOneUtterance(Speech: typeof ExpoSpeech, text: string, voice?: string): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    // Only offline voices are assigned; without one, use the engine default.
    Speech.speak(text, {
      ...(voice ? { voice } : {}),
      onDone: () => resolve(),
      // Speech.stop() reports onStopped, not onDone.
      onStopped: () => resolve(),
      onError: (error) => reject(error instanceof Error ? error : new Error(String(error))),
    });
  });
}

export async function speakUtterance(
  text: string,
  opts: SpeechOptions & { requestContext?: ApiRequestContext } = {},
): Promise<Uint8Array> {
  const requestContext = opts.requestContext ?? (await captureApiRequestContext());
  await ensureAiDataConsent({
    uses: ["voice"],
    status: () =>
      rpc(
        "aiConsent/status",
        { uses: ["voice"], ...(opts.scope ? { settingsScope: opts.scope } : {}) },
        { requestContext },
      ),
    prompt: promptAiConsent,
    allow: (input) =>
      rpc("aiConsent/allow", opts.scope ? { ...input, settingsScope: opts.scope } : input, {
        requestContext,
      }),
    coalesceKey: aiConsentCoalesceKey(requestContext),
  });
  return renderUtterance(text, opts, requestContext);
}

async function renderUtterance(
  text: string,
  opts: SpeechOptions,
  requestContext: ApiRequestContext,
): Promise<Uint8Array> {
  const deadline = requestDeadline(VOICE_RESPONSE_TIMEOUT_MS, "Voice request timed out.");
  try {
    const res = await withAbort(
      fetchServer(
        `${requestContext.apiBase}/api/voice/speak`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            origin: "atlas://",
            ...requestContext.headers,
          },
          body: JSON.stringify({
            text,
            voiceId: opts.voiceId,
            botId: opts.botId,
            scope: opts.scope,
          }),
          signal: deadline.signal,
        },
        requestContext.apiBase,
      ),
      deadline.signal,
      "Voice request aborted.",
    ).catch((error: unknown) => {
      throw deadline.signal.aborted
        ? error
        : new Error(errorText(error, t("Could not speak that.")));
    });
    if (!res.ok) {
      const body = await readVoiceError(res, deadline.signal);
      throw new Error(
        voiceAccountErrorText(body) ?? errorText(body.error ?? "", t("Could not speak that.")),
      );
    }
    return await readVoiceAudio(res, deadline.signal);
  } finally {
    deadline.dispose();
  }
}

// Hosted playback shares one HostedSession across a speakText call's utterances, so
// Pause/Resume/Stop keep working across the gap between them.

let hostedSpeechSession = 0;

function startHostedSpeechSession(): number {
  return ++hostedSpeechSession;
}

function isCurrentHostedSpeechSession(session: number): boolean {
  return session === hostedSpeechSession;
}

type HostedPlayerHandle = { pause(): void; resume(): void; stopNow(): void };

class HostedSession {
  private paused = false;
  private stopped = false;
  private player: HostedPlayerHandle | null = null;

  constructor(private readonly generation: number) {}

  get isStopped(): boolean {
    return this.stopped || !isCurrentHostedSpeechSession(this.generation);
  }

  get isPaused(): boolean {
    return this.paused;
  }

  setPlayer(player: HostedPlayerHandle | null): void {
    this.player = player;
    if (player && this.paused) player.pause();
  }

  pause(): void {
    this.paused = true;
    this.player?.pause();
  }

  resume(): void {
    this.paused = false;
    this.player?.resume();
  }

  stop(): void {
    this.stopped = true;
    this.player?.stopNow();
  }
}

/** Hosted voices send MP3; a server that renders speech itself (macOS) sends WAV. */
export function speechClipType(bytes: Uint8Array): { mimeType: string; extension: string } {
  const ascii = (start: number, end: number) => String.fromCharCode(...bytes.subarray(start, end));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WAVE"
    ? { mimeType: "audio/wav", extension: "wav" }
    : { mimeType: "audio/mpeg", extension: "mp3" };
}

export async function playSpeechClip(bytes: Uint8Array, session?: HostedSession): Promise<void> {
  const AudioCtor = (globalThis as { Audio?: typeof Audio }).Audio;
  if (typeof AudioCtor === "function") {
    await playWithHtmlAudio(AudioCtor, bytes, session);
    return;
  }
  await playWithNativeAudio(bytes, session);
}

async function playWithHtmlAudio(
  AudioCtor: typeof Audio,
  bytes: Uint8Array,
  session?: HostedSession,
): Promise<void> {
  if (session?.isStopped) return;
  const blob = new Blob([new Uint8Array(bytes)], { type: speechClipType(bytes).mimeType });
  const url = URL.createObjectURL(blob);
  try {
    const audio = new AudioCtor(url);
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        audio.onended = null;
        audio.onerror = null;
        session?.setPlayer(null);
        if (error) reject(error);
        else resolve();
      };
      audio.onended = () => finish();
      audio.onerror = () => finish(new Error(t("Could not play that clip.")));
      session?.setPlayer({
        pause: () => audio.pause(),
        resume: () => void audio.play().catch(() => undefined),
        stopNow: () => {
          audio.pause();
          finish();
        },
      });
      if (session?.isStopped) {
        finish();
        return;
      }
      if (session?.isPaused) return;
      try {
        void audio
          .play()
          .catch((error: unknown) =>
            finish(error instanceof Error ? error : new Error(t("Could not play that clip."))),
          );
      } catch (error) {
        finish(error instanceof Error ? error : new Error(t("Could not play that clip.")));
      }
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** How long a clip the system paused may wait to resume before the reply is dropped. */
const SYSTEM_PAUSE_GIVE_UP_MS = 10 * 60_000;

async function playWithNativeAudio(bytes: Uint8Array, session?: HostedSession): Promise<void> {
  if (session?.isStopped) return;
  await setAudioModeAsync(playbackAudioMode());
  const file = new File(
    Paths.cache,
    `atlas-voice-${Date.now()}.${speechClipType(bytes).extension}`,
  );
  file.create({ overwrite: true });
  file.write(bytesToBase64(bytes), { encoding: "base64" });
  const player = createAudioPlayer({ uri: file.uri });
  try {
    await new Promise<void>((resolve, reject) => {
      let settled = false;
      let started = false;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const finish = (error?: Error) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        sub.remove();
        session?.setPlayer(null);
        if (error) reject(error);
        else resolve();
      };
      const armStartupWatchdog = () => {
        timer = setTimeout(() => finish(new Error(t("Could not play that clip."))), 15_000);
      };
      const sub = player.addListener("playbackStatusUpdate", (status) => {
        if (status.error) {
          finish(new Error(status.error));
          return;
        }
        if (status.playbackState === "failed") {
          finish(new Error(t("Could not play that clip.")));
          return;
        }
        if (status.didJustFinish) {
          finish();
          return;
        }
        if (session?.isPaused) return;
        if (status.playing && status.duration > 0) {
          started = true;
          clearTimeout(timer);
          timer = setTimeout(
            () => finish(new Error(t("Could not play that clip."))),
            Math.min(120_000, Math.ceil(status.duration * 1000) + 8_000),
          );
        } else if (started && !status.playing) {
          // The system paused the clip (an iOS call, Siri). That is not a stall: wait for it to
          // come back, and give up quietly, without an error, if it never does.
          clearTimeout(timer);
          timer = setTimeout(() => {
            session?.stop();
            finish();
          }, SYSTEM_PAUSE_GIVE_UP_MS);
        }
      });
      session?.setPlayer({
        pause: () => {
          player.pause();
          // A long pause is not a stalled start. Leaving this timer armed
          // rejects the clip and drops Resume.
          clearTimeout(timer);
          timer = undefined;
        },
        resume: () => {
          player.play();
          if (!timer) armStartupWatchdog();
        },
        stopNow: () => {
          player.pause();
          finish();
        },
      });
      if (session?.isStopped) {
        finish();
        return;
      }
      if (session?.isPaused) return;
      armStartupWatchdog();
      try {
        player.play();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(t("Could not play that clip.")));
      }
    });
  } finally {
    player.release();
    try {
      file.delete();
    } catch {
      // already gone
    }
  }
}

function bytesToBase64(bytes: Uint8Array): string {
  if (typeof Buffer !== "undefined") return Buffer.from(bytes).toString("base64");
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/**
 * The reply-long audio focus request: held while speaking, let go after the same short grace as
 * the notification so a queue's next message does not make other audio swell in between.
 */
const speechFocus = (() => {
  const keeper = createPlaybackKeeper({
    start: async () => {
      const grant = await acquireSpeechFocus();
      if (grant === "delayed") interruptVoicePlayback("transient");
      return grant !== "failed";
    },
    stop: releaseSpeechFocus,
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });
  return {
    update(active: boolean): void {
      if (speechFocusSupported()) void keeper.update(active);
    },
    /** Asks again after another app took the audio for good. */
    reacquire(): void {
      if (!speechFocusSupported()) return;
      void keeper.release();
      void keeper.update(true);
    },
  };
})();

// The notification's Stop (or a headset / lock-screen control) ends whatever is being read.
onPlaybackStopRequested(() => stopVoicePlayback());

onSpeechFocusChange((change) => {
  if (change === "resumed") endVoiceInterruption();
  else interruptVoicePlayback(change === "lost" ? "lost" : "transient");
});
