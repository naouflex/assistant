import { describe, expect, it, vi } from "vitest";
import {
  chunkSentences,
  createReplySpeaker,
  liveStepLabels,
  SpeechStreamTracker,
  speakableSentences,
  WORKING_NARRATION_DELAY_MS,
  workingNarration,
} from "./speech-stream";

describe("streamed sentences", () => {
  it("holds back the sentence still being written until the reply ends", () => {
    expect(speakableSentences("The deploy is done. It took 3", false)).toEqual([
      "The deploy is done.",
    ]);
    expect(speakableSentences("The deploy is done. It took 3 minutes.", true)).toEqual([
      "The deploy is done.",
      "It took 3 minutes.",
    ]);
  });

  it("does not read a code block whose fence has not closed yet", () => {
    const text = "Here is the fix. Apply it now.\n\n```ts\nconst a = 1;\nconst b";
    expect(speakableSentences(text, false)).toEqual(["Here is the fix."]);
  });

  it("hands back only new sentences as the reply grows, then the rest at the end", () => {
    const tracker = new SpeechStreamTracker();
    expect(tracker.take("Checking the build.", false)).toEqual([]);
    expect(tracker.started).toBe(false);
    expect(tracker.take("Checking the build. It passed on", false)).toEqual([
      "Checking the build.",
    ]);
    expect(tracker.take("Checking the build. It passed on main. Next", false)).toEqual([
      "It passed on main.",
    ]);
    expect(tracker.take("Checking the build. It passed on main. Next, the release.", true)).toEqual(
      ["Next, the release."],
    );
    expect(tracker.started).toBe(true);
  });

  it("continues where it left off when the final message joins streamed segments", () => {
    const tracker = new SpeechStreamTracker();
    tracker.take("I'll look that up. One moment", false);
    // The final reply keeps the opening and adds what came after the tool call.
    expect(tracker.take("I'll look that up.\n\nIt opens at 8 pm tonight.", true)).toEqual([
      "It opens at 8 pm tonight.",
    ]);
  });

  it("reads text that replaced withdrawn text, without repeating what was said", () => {
    const tracker = new SpeechStreamTracker();
    tracker.take("Let me think. Hmm", false);
    expect(tracker.take("Here is the answer. It is the one. And", false)).toEqual([
      "Here is the answer.",
      "It is the one.",
    ]);
  });

  it("keeps a repeated sentence in order instead of skipping ahead", () => {
    const tracker = new SpeechStreamTracker();
    expect(tracker.take("Done. Next step. Done. Over", false)).toEqual([
      "Done.",
      "Next step.",
      "Done.",
    ]);
    expect(tracker.take("Done. Next step. Done. Over and out.", true)).toEqual(["Over and out."]);
  });

  it("groups sentences into chunks of up to one synthesis request", () => {
    expect(chunkSentences(["One.", "Two.", "Three."], 10)).toEqual(["One. Two.", "Three."]);
    expect(chunkSentences([])).toEqual([]);
  });
});

describe("working narration", () => {
  it("names a known step in English, and nothing that reads as an indicator", () => {
    expect(workingNarration(["Web search"], "en", "Working on it.")).toBe(
      "Working on it, searching the web.",
    );
    expect(workingNarration(["Bash"], "en", "Working on it.")).toBe(
      "Working on it, running a command.",
    );
    expect(workingNarration(["User computer shell"], "en", "Working on it.")).toBe(
      "Working on it.",
    );
    expect(workingNarration(["Web search"], "de", "Ich bin dran.")).toBe("Ich bin dran.");
  });

  it("lists step labels from a live message", () => {
    expect(
      liveStepLabels([
        { kind: "text" },
        { kind: "steps", steps: [{ label: "Web search" }, { label: "Read" }] },
      ]),
    ).toEqual(["Web search", "Read"]);
  });
});

function fakeSpeaker() {
  const timers: Array<{ run: () => void; cleared: boolean }> = [];
  const owners: symbol[] = [];
  const deps = {
    append: vi.fn(async (_chunks: string[], _owner: symbol) => true),
    speakWhole: vi.fn(async (_text: string) => true),
    createOwner: () => {
      const owner = Symbol("reply");
      owners.push(owner);
      return owner;
    },
    narration: vi.fn((_steps: readonly string[]) => "Working on it."),
    onOutcome: vi.fn(),
    setTimer: vi.fn((run: () => void, _ms: number) => {
      const timer = { run, cleared: false };
      timers.push(timer);
      return timer;
    }),
    clearTimer: (timer: unknown) => {
      (timer as { cleared: boolean }).cleared = true;
    },
  };
  const fire = () => {
    for (const timer of timers.splice(0)) if (!timer.cleared) timer.run();
  };
  return { speaker: createReplySpeaker(deps), deps, owners, fire };
}

describe("reply speaker", () => {
  it("reads sentences while the run streams and only the rest when it lands", async () => {
    const { speaker, deps, owners } = fakeSpeaker();
    speaker.live({ runId: "r1", text: "Booked it. Confirmation", stepLabels: [] });
    expect(deps.append).toHaveBeenCalledWith(["Booked it."], owners[0]);
    speaker.live({ runId: "r1", text: "Booked it. Confirmation sent. Bye", stepLabels: [] });
    expect(deps.append).toHaveBeenLastCalledWith(["Confirmation sent."], owners[0]);

    speaker.finish("Booked it. Confirmation sent. Bye for now.");
    expect(deps.append).toHaveBeenLastCalledWith(["Bye for now."], owners[0]);
    expect(deps.speakWhole).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(deps.onOutcome).toHaveBeenCalledWith({ spoken: true });
  });

  it("reads a reply whole when nothing streamed, so a long one can be summarized", () => {
    const { speaker, deps } = fakeSpeaker();
    speaker.live({ runId: "r1", text: "", stepLabels: [] });
    speaker.finish("All done.");
    expect(deps.speakWhole).toHaveBeenCalledWith("All done.");
    expect(deps.append).not.toHaveBeenCalled();
  });

  it("says it is working once when a run is busy with tools before saying anything", () => {
    const { speaker, deps, owners, fire } = fakeSpeaker();
    speaker.live({ runId: "r1", text: "", stepLabels: [] });
    expect(deps.setTimer).toHaveBeenCalledWith(expect.any(Function), WORKING_NARRATION_DELAY_MS);
    speaker.live({ runId: "r1", text: "", stepLabels: ["Web search"] });
    fire();
    expect(deps.narration).toHaveBeenCalledWith(["Web search"]);
    expect(deps.append).toHaveBeenCalledWith(["Working on it."], owners[0]);
    fire();
    expect(deps.append).toHaveBeenCalledOnce();
  });

  it("stays quiet when the run used no tools, or the reply started first", () => {
    const quiet = fakeSpeaker();
    quiet.speaker.live({ runId: "r1", text: "", stepLabels: [] });
    quiet.fire();
    expect(quiet.deps.append).not.toHaveBeenCalled();

    const talking = fakeSpeaker();
    talking.speaker.live({ runId: "r1", text: "Sure thing. Let", stepLabels: ["Read"] });
    talking.fire();
    expect(talking.deps.narration).not.toHaveBeenCalled();
  });

  it("starts fresh for a new run and reports a missing voice", async () => {
    const { speaker, deps, owners } = fakeSpeaker();
    deps.append.mockResolvedValueOnce(false);
    speaker.live({ runId: "r1", text: "First. Second", stepLabels: [] });
    speaker.live({ runId: "r2", text: "First. Again", stepLabels: [] });
    expect(owners).toHaveLength(2);
    expect(deps.append).toHaveBeenLastCalledWith(["First."], owners[1]);
    await Promise.resolve();
    expect(deps.onOutcome).toHaveBeenCalledWith({ spoken: false });
  });

  it("reports a failure to speak, and forgets an abandoned run", async () => {
    const { speaker, deps } = fakeSpeaker();
    deps.speakWhole.mockRejectedValueOnce(new Error("offline"));
    speaker.finish("Hello there.");
    await Promise.resolve();
    await Promise.resolve();
    expect(deps.onOutcome).toHaveBeenCalledWith({ error: expect.any(Error) });

    speaker.live({ runId: "r3", text: "Partial one. Two", stepLabels: [] });
    expect(speaker.streaming).toBe(true);
    speaker.abandon();
    expect(speaker.streaming).toBe(false);
  });
});
