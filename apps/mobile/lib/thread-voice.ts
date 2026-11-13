import { memberName, resolvePersonaColorDef } from "@atlas/core";
import { useNavigation, useRouter } from "expo-router";
import type { RefObject } from "react";
import { useCallback, useEffect, useLayoutEffect, useRef } from "react";
import { Alert, AppState } from "react-native";
import type { MobileBot, MobileMessage, MobileSnapshot } from "./api";
import { rpc } from "./api";
import { nextAutoSpeakAction } from "./auto-speak";
import { clearAutoSpeakFailure, noticeAutoSpeakFailure } from "./auto-speak-notice";
import { findSwitchTarget, ringOnArrival, takeRingOnArrival } from "./bot-switch";
import { setCallProviderTranscribe, startCall } from "./call-session";
import { loadDeviceVoiceEnabled } from "./device-voice";
import { available as dictationAvailable } from "./dictation";
import { getActiveUiLocale, useI18n } from "./i18n";
import { keepWaitingForReply } from "./playback-background";
import { currentSessionGeneration } from "./session";
import { createReplySpeaker, liveStepLabels, workingNarration } from "./speech-stream";
import { spokenMessageText } from "./spoken-text";
import { speakerColorFor } from "./thread-message-text";
import { errorText } from "./user-error";
import { appendSpeech, createSpeechOwner, speakQueue, speakText } from "./voice";
import { useBackgroundAutoSpeak } from "./voice-background";
import { probeProviderTranscribe, resolveVoiceCallPlan } from "./voice-call-entry";
import { onShortcutVoiceChat, takeShortcutVoiceChat } from "./voice-chat-intent";

const IN_PROGRESS_RUN_STATUSES = new Set(["running", "queued", "leased"]);

/**
 * Reads a bot's reply aloud when the bot has auto-speak on and its chat is in front (or, with
 * "Read replies in the background" on, behind another app): sentence by sentence while it streams,
 * the rest once it lands. Returns a ref to the latest check, for focus effects that must not
 * re-run on every message.
 */
export function useAutoSpeakReply({
  botId,
  inGroup,
  currentBot,
  snap,
  showingSaved,
}: {
  botId?: string;
  inGroup: boolean;
  currentBot?: MobileBot;
  snap: MobileSnapshot | null;
  showingSaved: boolean;
}) {
  const navigation = useNavigation();
  const { locale, t } = useI18n();
  const autoSpoken = useRef<string | null>(null);
  const autoSpokenBotId = useRef<string | null>(null);
  const background = useBackgroundAutoSpeak();
  const speaker = useRef(currentBot);
  useLayoutEffect(() => {
    speaker.current = currentBot;
  }, [currentBot]);

  const replySpeaker = useRef<ReturnType<typeof createReplySpeaker> | null>(null);
  replySpeaker.current ??= createReplySpeaker({
    append: (chunks, owner) => {
      const bot = speaker.current;
      return appendSpeech(
        chunks.map((text) => ({ text, ...speechIdentity(bot) })),
        owner,
      );
    },
    speakWhole: (text) => speakText(text, speechIdentity(speaker.current)),
    createOwner: createSpeechOwner,
    narration: (steps) => workingNarration(steps, getActiveUiLocale(), t("Working on it.")),
    onOutcome: (outcome) => {
      if ("error" in outcome) void noticeAutoSpeakFailure("failed");
      else if (!outcome.spoken) void noticeAutoSpeakFailure("no-voice");
      else void clearAutoSpeakFailure();
    },
    setTimer: (run, ms) => setTimeout(run, ms),
    clearTimer: (timer) => clearTimeout(timer as ReturnType<typeof setTimeout>),
  });

  const speakFinishedReply = useCallback(() => {
    const replies = replySpeaker.current;
    if (!botId || inGroup || !currentBot || !replies) return;
    const allowed = navigation.isFocused() && (AppState.currentState === "active" || background);
    const snapshotReady = snap?.botId === currentBot.id && !showingSaved;
    const run = snap?.run;
    const inProgress = Boolean(run && IN_PROGRESS_RUN_STATUSES.has(run.status));
    if (
      currentBot.autoSpeak &&
      allowed &&
      snapshotReady &&
      autoSpokenBotId.current === currentBot.id &&
      run &&
      inProgress
    ) {
      const live = snap?.messages.find((message) => message.id === `progress:${run.id}`);
      replies.live({
        runId: run.id,
        text: live ? spokenMessageText(live) : "",
        stepLabels: live ? liveStepLabels(live.blocks) : [],
      });
    }
    const decision = nextAutoSpeakAction({
      botId: currentBot.id,
      autoSpeak: currentBot.autoSpeak,
      focused: allowed,
      snapshotReady,
      lastSpokenBotId: autoSpokenBotId.current,
      lastSpokenMessageId: autoSpoken.current,
      runStatus: run?.status,
      messages: snap?.messages ?? [],
    });
    if (decision.action === "seed") {
      autoSpokenBotId.current = currentBot.id;
      autoSpoken.current = decision.messageId;
      if (!inProgress) replies.abandon();
      return;
    }
    if (decision.action !== "speak") {
      if (!inProgress && !replies.streaming) replies.abandon();
      return;
    }
    autoSpokenBotId.current = currentBot.id;
    autoSpoken.current = decision.messageId;
    replies.finish(decision.text);
  }, [
    background,
    botId,
    inGroup,
    currentBot,
    navigation,
    showingSaved,
    snap?.botId,
    snap?.messages,
    snap?.run,
  ]);

  const speakFinishedReplyRef = useRef(speakFinishedReply);
  useLayoutEffect(() => {
    speakFinishedReplyRef.current = speakFinishedReply;
  }, [speakFinishedReply]);

  useEffect(() => {
    speakFinishedReply();
    const appState = AppState.addEventListener("change", speakFinishedReply);
    return () => appState.remove();
  }, [speakFinishedReply]);

  // A new chat starts clean: nothing half-read carries over from the last one.
  useEffect(() => () => replySpeaker.current?.abandon(), [botId]);

  // With background reading on, a reply on its way keeps Atlas alive behind other apps. Started
  // while Atlas is still in front: Android refuses to start it from the background.
  const waitingName = currentBot?.name;
  const waiting = Boolean(
    background &&
      currentBot?.autoSpeak &&
      !inGroup &&
      snap?.botId === currentBot?.id &&
      snap?.run &&
      IN_PROGRESS_RUN_STATUSES.has(snap.run.status),
  );
  useEffect(() => {
    if (!waiting) return;
    keepWaitingForReply({
      title: waitingName ?? t("Bot"),
      text: t("Waiting for the reply"),
    });
    return () => keepWaitingForReply(null);
  }, [waiting, waitingName, locale, t]);

  return speakFinishedReplyRef;
}

/**
 * Whether the chat's live stream should stay open with Atlas in the background: background
 * reading is on, this bot reads its replies aloud, and one is being written now.
 */
export function useKeepLiveForSpeech({
  inGroup,
  currentBot,
  snap,
}: {
  inGroup: boolean;
  currentBot?: MobileBot;
  snap: MobileSnapshot | null;
}): boolean {
  const background = useBackgroundAutoSpeak();
  return Boolean(
    background &&
      !inGroup &&
      currentBot?.autoSpeak &&
      snap?.botId === currentBot.id &&
      snap?.run &&
      IN_PROGRESS_RUN_STATUSES.has(snap.run.status),
  );
}

function speechIdentity(bot: MobileBot | undefined) {
  if (!bot) return {};
  return {
    botId: bot.id,
    speaker: { name: bot.name, color: resolvePersonaColorDef(bot.id, bot.color).light },
  };
}

/** Reads the chat aloud from one message on, each bot reply in its speaker's voice. */
export function useSpeakMessages({
  visibleMessages,
  botId,
  members,
  displayName,
  mentionBots,
}: {
  visibleMessages: MobileMessage[];
  botId?: string;
  members: MobileSnapshot["members"] | undefined;
  displayName?: string;
  mentionBots: MobileBot[];
}) {
  const { t } = useI18n();
  const router = useRouter();
  return useCallback(
    (message: MobileMessage) => {
      const startIndex = visibleMessages.findIndex((candidate) => candidate.id === message.id);
      const fromHere = startIndex === -1 ? [message] : visibleMessages.slice(startIndex);
      const items = fromHere.flatMap((candidate) => {
        if (candidate.role !== "bot") return [];
        const text = spokenMessageText(candidate);
        if (!text) return [];
        const speakerBotId = candidate.botId ?? botId ?? members?.[0]?.botId ?? "";
        return [
          {
            text,
            botId: speakerBotId,
            messageId: candidate.id,
            speaker: {
              name: memberName(members, speakerBotId) ?? displayName,
              color: speakerColorFor(mentionBots, members, speakerBotId),
            },
          },
        ];
      });
      if (items.length === 0) return;
      void speakQueue(items)
        .then((spoken) => {
          if (!spoken)
            Alert.alert(t("Could not speak"), t("Add a voice provider in Voice settings."), [
              { text: t("Cancel"), style: "cancel" },
              { text: t("Open Voice"), onPress: () => router.push("/voice") },
            ]);
        })
        .catch((err: unknown) =>
          Alert.alert(t("Could not speak"), errorText(err, t("Try again."))),
        );
    },
    [botId, displayName, mentionBots, members, visibleMessages],
  );
}

/** Starts a voice call with the chat's bot, and answers when another bot's call put the caller through. */
export function useThreadVoiceCall({
  botId,
  readOnly,
  displayName,
  mentionBots,
  mentionBotsRef,
  activeBotId,
}: {
  botId?: string;
  readOnly: boolean;
  displayName?: string;
  mentionBots: MobileBot[];
  /** The newest bot list, read by a call that outlives renders. */
  mentionBotsRef: RefObject<MobileBot[]>;
  /** The bot whose chat is open now. */
  activeBotId: RefObject<string | undefined>;
}) {
  const { t } = useI18n();
  const router = useRouter();
  const voiceCallStarting = useRef(false);

  /**
   * `_switchedHere`: the caller was put through from another bot; the call still opens silently.
   * `setupSession`: the session the call belongs to. The checks below wait on the server; a
   * sign-in to another account meanwhile must not start this account's call with the new session.
   */
  async function startVoiceCall(_switchedHere = false, setupSession = currentSessionGeneration()) {
    if (readOnly) return;
    const targetBotId = botId;
    if (!targetBotId || voiceCallStarting.current) return;
    voiceCallStarting.current = true;
    const loadVoiceStatus = () => rpc("voice/status");
    try {
      // Like desktop, the call opens with the start cue and listens; the bot does not speak first.
      const plan = await resolveVoiceCallPlan({
        loadDeviceVoiceEnabled,
        dictationAvailable,
        loadVoiceStatus,
      });
      if (activeBotId.current !== targetBotId) return;
      if (plan.kind === "settings") {
        router.push("/voice");
        return;
      }
      if (plan.kind === "dictation") {
        Alert.alert(
          t("Calls need transcription"),
          t("Allow speech recognition in Settings, or connect ElevenLabs, OpenAI, or Fish Audio."),
          [
            { text: t("Not now"), style: "cancel" },
            { text: t("Open Voice"), onPress: () => router.push("/voice") },
          ],
        );
        return;
      }
      const botName = displayName ?? t("Bot");
      const startedCallId = startCall({
        botId: targetBotId,
        botName,
        botColor: mentionBots.find((bot) => bot.id === targetBotId)?.color,
        botAvatarSet: mentionBots.find((bot) => bot.id === targetBotId)?.avatarSet,
        transcribe: plan.transcribe,
        preferProvider: plan.kind === "provider" && plan.transcribe,
        session: setupSession,
        switchBot: (text) => {
          const target = findSwitchTarget(text, mentionBotsRef.current);
          if (!target || target.id === targetBotId) return undefined;
          return { name: target.name, ring: () => openBotChat(target, true) };
        },
      });
      if (!startedCallId) return;
      if (plan.kind === "device") {
        void probeProviderTranscribe(loadVoiceStatus)
          .then((enabled) => {
            if (enabled) setCallProviderTranscribe(true, startedCallId);
          })
          .catch(() => undefined);
      }
    } catch {
      if (activeBotId.current === targetBotId) router.push("/voice");
    } finally {
      voiceCallStarting.current = false;
    }
  }

  /** Opens another bot's chat in place of this one, ringing it when the switch came from a call. */
  function openBotChat(target: MobileBot, ring: boolean): void {
    if (ring) ringOnArrival(target.id, currentSessionGeneration());
    router.replace({ pathname: "/thread", params: { botId: target.id, name: target.name } });
  }

  // The shortcut can arrive long after this chat opened, e.g. once an archived chat is restored.
  const startVoiceCallRef = useRef(startVoiceCall);
  useLayoutEffect(() => {
    startVoiceCallRef.current = startVoiceCall;
  });

  // A read-only chat leaves the request waiting until it is restored.
  useEffect(() => {
    if (!botId || readOnly) return;
    const unsubscribe = onShortcutVoiceChat(() => {
      if (takeShortcutVoiceChat(botId)) void startVoiceCallRef.current();
    });
    const session = currentSessionGeneration();
    if (takeRingOnArrival(botId, session)) {
      void startVoiceCall(true, session);
    } else if (takeShortcutVoiceChat(botId)) {
      void startVoiceCall(false, session);
    }
    return unsubscribe;
  }, [botId, readOnly]);

  return { startVoiceCall, openBotChat };
}
