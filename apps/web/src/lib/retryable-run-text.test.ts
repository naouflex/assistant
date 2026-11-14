import type { ThreadSnapshot } from "@atlas/contracts";
import { expect, it } from "vitest";
import { retryableRunText } from "./thread-events";

function snapshot(
  run: { status: string; trigger: string } | null,
  messages: Array<{ id?: string; role: string; blocks: unknown[] }>,
): ThreadSnapshot {
  return {
    run: run ? { id: "run-1", ...run } : null,
    messages: messages.map((message, index) => ({ id: `m${index}`, ...message })),
  } as unknown as ThreadSnapshot;
}

const userText = (text: string) => ({ role: "user", blocks: [{ kind: "text", text }] });

it("returns the words of the user message a failed run never answered", () => {
  expect(
    retryableRunText(
      snapshot({ status: "failed", trigger: "user" }, [
        userText("hi"),
        { role: "bot", blocks: [{ kind: "text", text: "hello" }] },
        userText(" Book a table "),
        { id: "progress:run-1", role: "bot", blocks: [{ kind: "text", text: "Looking…" }] },
      ]),
    ),
  ).toBe("Book a table");
});

it("offers nothing to resend when the run did not fail on a plain user message", () => {
  const failed = { status: "failed", trigger: "user" };
  expect(retryableRunText(null)).toBeNull();
  expect(
    retryableRunText(snapshot({ status: "completed", trigger: "user" }, [userText("x")])),
  ).toBeNull();
  expect(
    retryableRunText(snapshot({ status: "failed", trigger: "routine" }, [userText("x")])),
  ).toBeNull();
  expect(
    retryableRunText(
      snapshot(failed, [
        userText("x"),
        { role: "bot", blocks: [{ kind: "text", text: "partial" }] },
      ]),
    ),
  ).toBeNull();
  expect(
    retryableRunText(
      snapshot(failed, [
        { role: "user", blocks: [{ kind: "text", text: "see" }, { kind: "image" }] },
      ]),
    ),
  ).toBeNull();
});
