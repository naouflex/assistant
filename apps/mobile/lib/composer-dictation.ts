/**
 * Hold-to-talk for the thread composer: press the mic, speak, release to drop the
 * words into the draft. A connected voice provider that transcribes hears the
 * recording; without one, the device's own recognizer listens.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as dictation from "./dictation";
import type { HeldRecording } from "./provider-dictation";
import { providerTranscribes, startHeldRecording, transcribeVoiceClip } from "./provider-dictation";

/** Joins a prior draft with freshly heard words without doubling a trailing space. */
export function mergeDictation(base: string, heard: string): string {
  const text = heard.trim();
  if (!text) return base;
  if (!base) return text;
  return /[\s\n]$/.test(base) ? `${base}${text}` : `${base} ${text}`;
}

type Engine = "provider" | "device" | null;

export function useComposerDictation({
  disabled,
  draft,
  onDraft,
}: {
  disabled?: boolean;
  /** Current composer text when a hold starts; interim updates rebuild from this base. */
  draft: string;
  onDraft: (text: string) => void;
}) {
  const [engine, setEngine] = useState<Engine>(null);
  const [listening, setListening] = useState(false);
  const baseRef = useRef("");
  const draftRef = useRef(draft);
  const onDraftRef = useRef(onDraft);
  const listeningRef = useRef(false);
  const holdGen = useRef(0);
  const recording = useRef<Promise<HeldRecording | null> | null>(null);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      // Asking the device recognizer would prompt for speech access the provider does not need.
      const next: Engine = (await providerTranscribes())
        ? "provider"
        : (await dictation.available())
          ? "device"
          : null;
      if (!cancelled) setEngine(next);
    })();
    return () => {
      cancelled = true;
      holdGen.current += 1;
      if (listeningRef.current) dictation.stop();
      void recording.current?.then((held) => held?.cancel());
    };
  }, []);

  const apply = useCallback((heard: string) => {
    onDraftRef.current(mergeDictation(baseRef.current, heard));
  }, []);

  const endHold = useCallback((gen: number) => {
    if (holdGen.current !== gen) return;
    listeningRef.current = false;
    recording.current = null;
    setListening(false);
  }, []);

  const available = engine !== null;

  const start = useCallback(() => {
    if (disabled || !engine || listeningRef.current) return;
    const gen = ++holdGen.current;
    baseRef.current = draftRef.current;
    listeningRef.current = true;
    setListening(true);
    if (engine === "provider") {
      recording.current = startHeldRecording().catch(() => null);
      void recording.current.then((held) => {
        if (!held) endHold(gen);
      });
      return;
    }
    void dictation.listen({
      onInterim: (text) => {
        if (holdGen.current !== gen) return;
        apply(text);
      },
      onFinal: (text) => {
        if (holdGen.current !== gen) return;
        apply(text);
        endHold(gen);
      },
      onGiveUp: () => endHold(gen),
    });
  }, [apply, disabled, endHold, engine]);

  const release = useCallback(() => {
    if (!listeningRef.current) return;
    const gen = holdGen.current;
    if (engine === "provider") {
      const pending = recording.current;
      void (async () => {
        try {
          const clip = await (await pending)?.finish();
          if (!clip || holdGen.current !== gen) return;
          const result = await transcribeVoiceClip(clip);
          if (holdGen.current === gen && "text" in result) apply(result.text);
        } catch {
          // A failed take leaves the draft as it was.
        } finally {
          endHold(gen);
        }
      })();
      return;
    }
    dictation.commit();
    // commit may already have cleared via onFinal; if nothing was heard, stop the session.
    if (listeningRef.current) {
      dictation.stop();
      endHold(gen);
    }
  }, [apply, endHold, engine]);

  return {
    available,
    listening,
    start: disabled || !available ? () => {} : start,
    release: disabled || !available ? () => {} : release,
  };
}
