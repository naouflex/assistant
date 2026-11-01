import type { Artifact } from "@atlas/contracts";
import { Spinner } from "@atlas/ui-web";
import { useLingui } from "@lingui/react/macro";
import { skipToken, useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useRef, useState } from "react";
import { ArtifactPreview } from "../../components/ArtifactPreview";
import { decodeArtifactBase64 } from "../../lib/artifact-open";
import { useSpaceQueries } from "../../lib/query";
import { errorText } from "../../lib/user-error";
import { ChartCanvas } from "./message-cards";

/** Compact artifact viewer for the chat side panel. */
export function ArtifactSideView({ artifactId }: { artifactId: string }) {
  const { t } = useLingui();
  const queries = useSpaceQueries();
  const artifactQuery = useQuery(
    queries.artifacts.getById.queryOptions({
      input: artifactId ? { artifactId } : skipToken,
    }),
  );
  const bytes = useMemo(
    () => (artifactQuery.data ? decodeArtifactBase64(artifactQuery.data.contentBase64) : null),
    [artifactQuery.data],
  );
  const state:
    | { status: "loading" }
    | { status: "ready"; artifact: Artifact; bytes: Uint8Array }
    | { status: "error"; message: string } =
    artifactQuery.data && bytes
      ? { status: "ready", artifact: artifactQuery.data, bytes }
      : artifactQuery.error
        ? {
            status: "error",
            message: errorText(artifactQuery.error, t`Could not load this artifact.`),
          }
        : { status: "loading" };

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 className="truncate text-[13.5px] font-medium text-foreground">
        {state.status === "ready" ? state.artifact.name : null}
      </h2>
      <div className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-border">
        {state.status === "loading" ? (
          <div className="grid h-full min-h-[12rem] place-items-center text-sm text-muted-foreground/80">
            <Spinner aria-label={t`Loading…`} />
          </div>
        ) : state.status === "error" ? (
          <div className="m-3 rounded-xl border border-destructive/40 bg-destructive/10 px-4 py-3 text-destructive">
            {state.message}
          </div>
        ) : (
          <ArtifactPreview artifact={state.artifact} bytes={state.bytes} />
        )}
      </div>
    </div>
  );
}

export type ChartPanelPayload = {
  name: string;
  spec: Record<string, unknown>;
  data: unknown[];
};

/** Chart block expanded into the chat side panel. */
export function ChartSideView({ chart }: { chart: ChartPanelPayload }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(320);
  useEffect(() => {
    const element = host.current;
    if (!element || typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width;
      if (next && next > 0) setWidth(Math.floor(next));
    });
    observer.observe(element);
    setWidth(Math.floor(element.clientWidth) || 320);
    return () => observer.disconnect();
  }, []);
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3">
      <h2 className="truncate text-[13.5px] font-medium text-foreground">{chart.name}</h2>
      <div ref={host} className="min-h-0 flex-1 overflow-auto">
        <ChartCanvas spec={chart.spec} data={chart.data} width={width} />
      </div>
    </div>
  );
}
