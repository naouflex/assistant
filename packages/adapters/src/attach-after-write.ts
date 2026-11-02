import { automated } from "./automated-messages.js";

export const ATTACH_AFTER_WRITE_PROMPT = automated(
  "You wrote the file but did not attach it. Call attach_file with the same path before any reply so it appears in the chat.",
);
