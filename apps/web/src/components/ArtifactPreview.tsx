import { ChatMarkdown } from "@atlas/chat-ui/web";
import type { Artifact } from "@atlas/contracts";
import { isAttachmentImageMimeType } from "@atlas/contracts";
import { Trans } from "@lingui/react/macro";
import { useObjectUrl } from "../lib/use-object-url";
import { PdfViewer } from "./PdfViewer";
import { SandboxedHtmlViewer } from "./SandboxedHtmlViewer";

export function ArtifactPreview({ artifact, bytes }: { artifact: Artifact; bytes: Uint8Array }) {
  if (artifact.mimeType === "text/html") {
    const html = new TextDecoder("utf-8").decode(bytes);
    return <SandboxedHtmlViewer html={html} title={artifact.name} />;
  }
  if (artifact.mimeType === "text/markdown") {
    const text = new TextDecoder("utf-8").decode(bytes);
    return (
      <div className="h-full overflow-y-auto bg-background">
        <article className="mx-auto w-full max-w-[760px] px-8 py-10 text-[16px] leading-7 text-foreground">
          <ChatMarkdown>{text}</ChatMarkdown>
        </article>
      </div>
    );
  }
  if (artifact.mimeType === "application/pdf") {
    return <PdfViewer bytes={bytes} title={artifact.name} />;
  }
  if (isAttachmentImageMimeType(artifact.mimeType)) {
    return <ImagePreview bytes={bytes} mimeType={artifact.mimeType} name={artifact.name} />;
  }
  return (
    <div className="grid h-full place-items-center px-6 text-center text-sm text-muted-foreground/80">
      <Trans>Preview isn't available for this file type — download it to view it.</Trans>
    </div>
  );
}

function ImagePreview({
  bytes,
  mimeType,
  name,
}: {
  bytes: Uint8Array;
  mimeType: string;
  name: string;
}) {
  const url = useObjectUrl(bytes, mimeType);
  if (!url) return null;
  return (
    <div className="grid h-full place-items-center overflow-auto bg-muted/40 p-4">
      <img src={url} alt={name} className="max-h-full max-w-full rounded-lg shadow-sm" />
    </div>
  );
}
