import { describe, expect, it } from "vitest";
import { spokenMessageText } from "./spoken-text";

describe("spokenMessageText", () => {
  it("reads the reply, not the tool steps and activity around it", () => {
    expect(
      spokenMessageText({
        blocks: [
          { kind: "steps", steps: [{ label: "User computer shell", count: 2 }] },
          { kind: "progress", text: "Running user_computer_shell", activity: true },
          { kind: "text", text: "Freed 4 GB on C." },
          { kind: "file", artifactId: "a1", mimeType: "text/plain", name: "log.txt", size: 12 },
        ],
      }),
    ).toBe("Freed 4 GB on C.");
  });

  it("is empty for a message that is only working indicators", () => {
    expect(
      spokenMessageText({
        blocks: [
          { kind: "steps", steps: [{ label: "Web search", count: 3 }] },
          { kind: "meta", text: "Created by Chief" },
        ],
      }),
    ).toBe("");
  });
});
