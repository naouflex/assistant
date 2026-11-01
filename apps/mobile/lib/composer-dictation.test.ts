// @vitest-environment jsdom

import type { ReactNode } from "react";
import { act, createElement, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mergeDictation, useComposerDictation } from "./composer-dictation";

const dictation = vi.hoisted(() => {
  const state = {
    available: vi.fn(async () => true),
    listen: vi.fn(async () => {}),
    commit: vi.fn(),
    stop: vi.fn(),
    staged: "",
    handlers: null as null | {
      onInterim?: (text: string) => void;
      onFinal: (text: string) => void;
      onGiveUp?: (reason: "idle" | "failed") => void;
    },
  };
  return state;
});

vi.mock("./dictation", () => ({
  available: () => dictation.available(),
  listen: (opts: {
    onInterim?: (text: string) => void;
    onFinal: (text: string) => void;
    onGiveUp?: (reason: "idle" | "failed") => void;
  }) => {
    dictation.handlers = opts;
    return dictation.listen(opts);
  },
  commit: () => {
    dictation.commit();
    const handlers = dictation.handlers;
    if (!handlers) return;
    const text = dictation.staged.trim();
    if (text) handlers.onFinal(text);
  },
  stop: () => {
    dictation.stop();
    dictation.handlers = null;
  },
}));

function Harness({
  disabled,
  onReady,
}: {
  disabled?: boolean;
  onReady: (api: ReturnType<typeof useComposerDictation> & { draft: string }) => void;
}) {
  const [draft, setDraft] = useState("");
  const talk = useComposerDictation({ disabled, draft, onDraft: setDraft });
  onReady({ ...talk, draft });
  return null;
}

describe("mergeDictation", () => {
  it("fills an empty draft and spaces an existing one", () => {
    expect(mergeDictation("", "hello")).toBe("hello");
    expect(mergeDictation("Notes", "hello")).toBe("Notes hello");
    expect(mergeDictation("Notes ", "hello")).toBe("Notes hello");
    expect(mergeDictation("Notes\n", "hello")).toBe("Notes\nhello");
    expect(mergeDictation("Notes", "  ")).toBe("Notes");
  });
});

describe("useComposerDictation", () => {
  let root: Root;
  let container: HTMLDivElement;
  let api: (ReturnType<typeof useComposerDictation> & { draft: string }) | null;

  beforeEach(() => {
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
    api = null;
    dictation.staged = "";
    dictation.available.mockResolvedValue(true);
    dictation.listen.mockClear();
    dictation.commit.mockClear();
    dictation.stop.mockClear();
    dictation.handlers = null;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  function render(disabled?: boolean) {
    act(() => {
      root.render(
        createElement(Harness, {
          disabled,
          onReady: (next) => {
            api = next;
          },
        }) as ReactNode,
      );
    });
  }

  it("hides itself when dictation is unavailable", async () => {
    dictation.available.mockResolvedValue(false);
    render();
    await act(async () => {});
    expect(api?.available).toBe(false);
    act(() => api?.start());
    expect(dictation.listen).not.toHaveBeenCalled();
  });

  it("writes interim and committed speech into the draft", async () => {
    render();
    await act(async () => {});
    expect(api?.available).toBe(true);

    act(() => api?.start());
    expect(dictation.listen).toHaveBeenCalledOnce();
    expect(api?.listening).toBe(true);

    act(() => dictation.handlers?.onInterim?.("meeting notes"));
    expect(api?.draft).toBe("meeting notes");

    dictation.staged = "meeting notes for friday";
    act(() => api?.release());
    expect(dictation.commit).toHaveBeenCalledOnce();
    expect(api?.draft).toBe("meeting notes for friday");
    expect(api?.listening).toBe(false);
  });

  it("appends after existing draft text", async () => {
    render();
    await act(async () => {});
    act(() => api?.start());
    dictation.staged = "first";
    act(() => api?.release());
    expect(api?.draft).toBe("first");

    act(() => api?.start());
    act(() => dictation.handlers?.onInterim?.("second"));
    expect(api?.draft).toBe("first second");
  });

  it("no-ops while disabled", async () => {
    render(true);
    await act(async () => {});
    act(() => api?.start());
    expect(dictation.listen).not.toHaveBeenCalled();
  });
});
