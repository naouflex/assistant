import { describe, expect, it } from "vitest";
import { applyMessageDraftEdits, messageDraftFields } from "./message-draft.js";

describe("messageDraftFields", () => {
  it("reads recipient, subject and body from send arguments", () => {
    expect(
      messageDraftFields({
        to: ["a@example.test", "b@example.test"],
        subject: "Hi",
        body: "Hello",
      }),
    ).toEqual([
      { key: "to", label: "To", value: "a@example.test, b@example.test" },
      { key: "subject", label: "Subject", value: "Hi" },
      { key: "body", label: "Message", value: "Hello", multiline: true },
    ]);
  });

  it("offers no draft without a message body", () => {
    expect(messageDraftFields({ to: "a@example.test", draft_id: "d1" })).toBeUndefined();
  });
});

describe("applyMessageDraftEdits", () => {
  const fields = messageDraftFields({ to: ["a@example.test"], subject: "Hi", body: "Hello" })!;

  it("replaces the edited fields where the card's values live, keeping arrays", () => {
    const request = [
      "marker",
      "mcp_execute_tool",
      { tool: "send", arguments: { to: ["a@example.test"], subject: "Hi", body: "Hello" } },
    ];
    expect(
      applyMessageDraftEdits(request, fields, {
        body: "Hello there",
        to: "c@example.test, d@example.test",
      }),
    ).toEqual([
      "marker",
      "mcp_execute_tool",
      {
        tool: "send",
        arguments: { to: ["c@example.test", "d@example.test"], subject: "Hi", body: "Hello there" },
      },
    ]);
  });

  it("refuses fields the card did not show, or a request that no longer matches", () => {
    const request = { to: ["a@example.test"], subject: "Hi", body: "Hello" };
    expect(applyMessageDraftEdits(request, fields, { bcc: "x@example.test" })).toBeUndefined();
    expect(applyMessageDraftEdits(request, fields, { body: 3 })).toBeUndefined();
    expect(
      applyMessageDraftEdits({ ...request, body: "Changed" }, fields, { body: "Edit" }),
    ).toBeUndefined();
  });
});
