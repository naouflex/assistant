import { describe, expect, it } from "vitest";
import { userMessagesSincePause } from "./pi-runtime.js";

describe("userMessagesSincePause", () => {
  const history = [
    { id: "user-1", role: "user" },
    { id: "ask", role: "assistant" },
    { id: "later", role: "user" },
  ];

  it("drops the approval card that arrived while the turn was paused", () => {
    expect(userMessagesSincePause(history, new Set(["user-1"]))).toEqual([
      { id: "later", role: "user" },
    ]);
  });

  it("keeps nothing when the only new row is the card", () => {
    expect(userMessagesSincePause(history.slice(0, 2), new Set(["user-1"]))).toEqual([]);
  });
});
