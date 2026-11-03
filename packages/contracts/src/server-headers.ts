import type { ModelHeaderRow } from "./model-headers.js";
import { ModelHeaderRowsSchema, ModelHeadersSchema } from "./model-headers.js";

export const ATLAS_SPACE_ID_HEADER = "x-atlas-space-id";
/** Legacy Rakazo clients still send this name; the API accepts both. */
export const LEGACY_SPACE_ID_HEADER = "x-rakazo-space-id";

type HeaderLookup = { get(name: string): string | null | undefined };

/** Space the client is acting in, when it sent one of the supported headers. */
export function requestedSpaceId(headers: HeaderLookup): string | null {
  const id =
    headers.get(ATLAS_SPACE_ID_HEADER)?.trim() ||
    headers.get(LEGACY_SPACE_ID_HEADER)?.trim() ||
    "";
  return id || null;
}

/** Atlas names its own request headers; a configured header must not replace them. */
function allowedServerHeaderName(name: string): boolean {
  const lower = name.trim().toLowerCase();
  return (
    ![
      "origin",
      "referer",
      "cookie2",
      "set-cookie",
      "via",
      "forwarded",
      "x-forwarded-for",
      "x-forwarded-host",
      "x-forwarded-proto",
    ].includes(lower) && !lower.startsWith("x-atlas-")
  );
}

/**
 * Headers a client sends with every request to one server, such as an access proxy's
 * service credentials. Validated before storage and again when read back.
 */
export const ServerHeadersSchema = ModelHeadersSchema.refine(
  (headers) => Object.keys(headers).every(allowedServerHeaderName),
  "Invalid custom headers",
);

/** Null for anything unusable, so a damaged saved value never reaches a request. */
export function parseServerHeaders(input: unknown): Record<string, string> | null {
  const parsed = ServerHeadersSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

export function serverHeadersFromRows(rows: ModelHeaderRow[]): Record<string, string> {
  const filled = rows.filter((row) => row.name.trim() !== "" || row.value !== "");
  const parsed = ModelHeaderRowsSchema.safeParse(filled);
  const headers = parsed.success
    ? parseServerHeaders(Object.fromEntries(parsed.data.map((row) => [row.name, row.value])))
    : null;
  if (headers === null) throw new Error("Invalid custom headers");
  return headers;
}
