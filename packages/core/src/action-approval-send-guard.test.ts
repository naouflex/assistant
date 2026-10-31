import { describe, expect, it } from "vitest";
import { connectorToolSendsMessage } from "./action-approval.js";

describe("connectorToolSendsMessage", () => {
  it("flags tools that deliver a message", () => {
    for (const name of [
      "GMAIL_SEND_EMAIL",
      "gmail_reply_to_thread",
      "OUTLOOK_FORWARD_MESSAGE",
      "slack_send_message",
      "SLACK_POST_MESSAGE",
      "GMAIL_SEND_DRAFT",
      "github_create_comment",
      "twilio_sms",
    ]) {
      expect(connectorToolSendsMessage(name), name).toBe(true);
    }
  });

  it("leaves drafts and reads alone", () => {
    for (const name of [
      "GMAIL_CREATE_DRAFT",
      "gmail_update_draft",
      "slack_send_message_draft",
      "GMAIL_FETCH_EMAILS",
      "slack_search_messages",
      "calendar_list_events",
    ]) {
      expect(connectorToolSendsMessage(name), name).toBe(false);
    }
  });
});
