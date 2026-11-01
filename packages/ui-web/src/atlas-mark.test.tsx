import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AtlasLockup, AtlasMark } from "./atlas-mark.js";

describe("AtlasMark", () => {
  it("renders an accessible mountain mark with a mask id Chromium can resolve", () => {
    const html = renderToString(<AtlasMark size={24} />);
    expect(html).toContain('data-testid="atlas-mark"');
    expect(html).toContain('role="img"');
    expect(html).toContain('aria-label="Atlas"');
    expect(html).toContain('width="24"');
    const id = html.match(/mask id="([^"]+)"/)?.[1];
    expect(id).toBeTruthy();
    expect(id).not.toContain(":");
    expect(html).toContain(`mask="url(#${id})"`);
  });
});

describe("AtlasLockup", () => {
  it("shows lowercase atlas next to the mark", () => {
    const html = renderToString(<AtlasLockup />);
    expect(html).toContain('data-testid="atlas-lockup"');
    expect(html).toContain(">[atlas]<");
    expect(html).toContain("font-mono");
    expect(html).toContain("text-[22px]");
    expect(html).toContain("lowercase");
  });

  it("hides the word when the sidebar is mini", () => {
    const html = renderToString(<AtlasLockup mini />);
    expect(html).not.toContain(">[atlas]<");
    expect(html).toContain('aria-label="Atlas"');
  });
});
