/** Avoid echoing multi-line content or huge constraint text to stderr from CLI errors. */
export function redactCliError(message: string): string {
  const oneLine = message.replace(/\s+/g, " ").trim();
  if (oneLine.length > 160) return `${oneLine.slice(0, 157)}…`;
  return oneLine;
}
