/**
 * Hold-to-talk for the thread composer: press the mic, speak, release to drop the
 * words into the draft. Reuses on-device `dictation.listen` (no separate speech stack).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import * as dictation from "./dictation";

/** Joins a prior draft with freshly heard words without doubling a trailing space. */
export function mergeDictation(base: string, heard: string): string {
  const text = heard.trim();
  if (!text) return base;
  if (!base) return text;
  return /[\s\n]$/.test(base) ? `${base}${text}` : `${base} ${text}`;
}

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
  const [available, setAvailable] = useState(false);
  const [listening, setListening] = useState(false);
  const baseRef = useRef("");
  const draftRef = useRef(draft);
  const onDraftRef = useRef(onDraft);
  const listeningRef = useRef(false);
  const holdGen = useRef(0);

  useEffect(() => {
    draftRef.current = draft;
  }, [draft]);
  useEffect(() => {
    onDraftRef.current = onDraft;
  }, [onDraft]);

  useEffect(() => {
    let cancelled = false;
    void dictation.available().then((ok) => {
      if (!cancelled) setAvailable(ok);
    });
    return () => {
      cancelled = true;
      if (listeningRef.current) dictation.stop();
    };
  }, []);

  const apply = useCallback((heard: string) => {
    onDraftRef.current(mergeDictation(baseRef.current, heard));
  }, []);

  const endHold = useCallback((gen: number) => {
    if (holdGen.current !== gen) return;
    listeningRef.current = false;
    setListening(false);
  }, []);

  const start = useCallback(() => {
    if (disabled || !available || listeningRef.current) return;
    const gen = ++holdGen.current;
    baseRef.current = draftRef.current;
    listeningRef.current = true;
    setListening(true);
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
  }, [apply, available, disabled, endHold]);

  const release = useCallback(() => {
    if (!listeningRef.current) return;
    dictation.commit();
    // commit may already have cleared via onFinal; if nothing was heard, stop the session.
    if (listeningRef.current) {
      dictation.stop();
      endHold(holdGen.current);
    }
  }, [endHold]);

  return {
    available,
    listening,
    start: disabled || !available ? () => {} : start,
    release: disabled || !available ? () => {} : release,
  };
}
