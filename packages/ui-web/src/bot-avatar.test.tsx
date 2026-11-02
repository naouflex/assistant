import { botAvatarWordValue } from "@atlas/contracts";
import { ACTIVE_RUN_STATUSES, avatarWordShapePath, SHIPPED_BOT_AVATAR_IMAGES } from "@atlas/core";
import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  BOT_AVATAR_COLORS,
  BotAvatar,
  BotShapePreview,
  DEFAULT_BOT_AVATAR_COLOR,
  defaultBotAvatarValue,
  parseBotAvatar,
  resolvePersonaColorDef,
} from "./bot-avatar.js";

describe("BotAvatar", () => {
  it("renders distinct SVG gradient IDs for concurrent working avatars", () => {
    const html = renderToString(
      <div>
        <BotAvatar color="#8B5CF6::shape_0" status="running" />
        <BotAvatar color="#10B981::shape_1" status="running" />
      </div>,
    );

    const gradMatches = [...html.matchAll(/id="([^"]+)"/g)].map((m) => m[1]);
    expect(gradMatches).toHaveLength(4);
    expect(new Set(gradMatches).size).toBe(4);
    for (const id of gradMatches) {
      expect(id).toBeTruthy();
      expect(html).toContain(`url(#${id})`);
    }
  });

  // Button sizes any SVG without a size class, which beats width/height attributes but not inline styles.
  it("sizes the shape with an inline style so icon sizing in a button cannot shrink it", () => {
    const html = renderToString(<BotAvatar color="#8B5CF6::shape_0" size={26} />);
    const shape = html.match(/<svg[^>]*atlas-shape-avatar[^>]*>/)?.[0];
    expect(shape).toMatch(/style="[^"]*width:26px;height:26px/);
  });

  it.each([...ACTIVE_RUN_STATUSES])("marks active run status %s as working", (status) => {
    const html = renderToString(<BotAvatar color="#3B82F6" status={status} />);
    expect(html).toContain("<svg");
    expect(html).toContain('data-working="true"');
  });

  it("keeps working attribute false when idle", () => {
    const html = renderToString(<BotAvatar color="#F59E0B" status="idle" />);
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("atlas-bot-avatar-ring");
  });

  it("circles a working organic avatar with the same status ring as a photo", () => {
    const html = renderToString(<BotAvatar color="#3B82F6" identity="maya" status="running" />);
    expect(html).toContain("atlas-organic-avatar");
    expect(html).toContain("atlas-bot-avatar-ring-working");
    expect(html).toContain("stroke-status-working");
  });

  it("circles a working Atlas logo with the same status ring", () => {
    const working = renderToString(
      <BotAvatar color="#10B981" identity="chief" avatarSet="atlas" status="running" />,
    );
    expect(working).toContain("atlas-logo-avatar");
    expect(working).toContain("atlas-bot-avatar-ring-working");
    expect(working).toContain("stroke-status-working");
    const idle = renderToString(
      <BotAvatar color="#10B981" identity="chief" avatarSet="atlas" status="idle" />,
    );
    expect(idle).not.toContain("atlas-bot-avatar-ring");
  });

  it("renders distinct shapes for distinct bot identities", () => {
    const maya = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    const github = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="github" />);
    expect(maya).not.toEqual(github);
  });

  it("draws an anchor when the word is anchor", () => {
    const value = botAvatarWordValue("#8B5CF6", "anchor")!;
    const html = renderToString(<BotAvatar color={value} identity="maya" size={32} />);
    expect(html).toContain("M12 6v16");
    expect(html).toContain('class="atlas-word-icon');
    expect(html).not.toContain("atlas-organic-avatar-eyes");
  });

  it("draws a word as its own body instead of the logo", () => {
    const value = botAvatarWordValue("#8B5CF6", "river")!;
    const html = renderToString(
      <BotAvatar color={value} identity="maya" avatarSet="atlas" size={32} />,
    );
    expect(html).toContain(avatarWordShapePath("river"));
    expect(html).not.toContain("atlas-logo-avatar");
    expect(parseBotAvatar(value).word).toBe("river");
    expect(defaultBotAvatarValue(value)).toBe("#8B5CF6");
  });

  it("parses shape indexes from encoded color values", () => {
    const parsed = parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`);
    expect(parsed.color).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(parsed.shapeIndex).toBe(3);
    expect(parsed.isImage).toBe(false);
  });

  it("normalizes malformed shape suffixes to shape 0", () => {
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_-1`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3junk`).shapeIndex).toBe(0);
    expect(parseBotAvatar(`${DEFAULT_BOT_AVATAR_COLOR}::shape_`).shapeIndex).toBe(0);
  });

  it("resolves explicit colors and shapes", () => {
    expect(resolvePersonaColorDef("bot", "#10B981").hex.toLowerCase()).toBe("#10b981");
    expect(resolvePersonaColorDef("bot", "#fff").hex).toBe("#fff");
    expect(BOT_AVATAR_COLORS.length).toBeGreaterThan(0);
  });

  it("falls back to the identity palette for invalid custom hex", () => {
    expect(resolvePersonaColorDef("bot", "#zzzzzz")).toEqual(resolvePersonaColorDef("bot"));
    expect(resolvePersonaColorDef("bot", "#ggg")).toEqual(resolvePersonaColorDef("bot"));
  });

  it("renders uploaded images without the geometric svg", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} />,
    );
    expect(html).toContain("<img");
    expect(html).not.toContain("<path");
    expect(html).not.toContain("bot-character-eyes");
  });

  it("keeps a working photo ring outside the clipped image and uses the status token", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('class="atlas-bot-avatar relative shrink-0 select-none"');
    expect(html).toContain("atlas-bot-avatar-picture");
    expect(html).toContain("atlas-bot-avatar-ring-working");
    expect(html).toContain("stroke-status-working");
    expect(html).toContain('data-working="true"');
    expect(html.indexOf("atlas-bot-avatar-picture")).toBeLessThan(
      html.indexOf("atlas-bot-avatar-ring"),
    );
  });

  it("keeps idle photo avatars ring-free", () => {
    const html = renderToString(
      <BotAvatar color="data:image/png;base64,abc" identity="maya" size={32} status="idle" />,
    );
    expect(html).toContain("atlas-bot-avatar-picture");
    expect(html).toContain('data-working="false"');
    expect(html).not.toContain("atlas-bot-avatar-ring");
  });

  it("does not treat arbitrary http(s) color values as remote images", () => {
    const parsed = parseBotAvatar("https://evil.example/track.png");
    expect(parsed.isImage).toBe(false);
    expect(parsed.imageUrl).toBeUndefined();
    const html = renderToString(
      <BotAvatar color="https://evil.example/track.png" identity="maya" size={32} />,
    );
    expect(html).not.toContain("<img");
    expect(html).not.toContain("evil.example");
  });

  it("marks a working studio shape so organic CSS can drive its motion", () => {
    const html = renderToString(
      <BotAvatar color="#8B5CF6::shape_0" identity="maya" size={32} status="running" />,
    );
    expect(html).toContain('data-working="true"');
    expect(html).toContain("atlas-organic-avatar-body-working");
    expect(html).toContain("atlas-organic-avatar-eyes-working");
  });

  it("restores a plain color that renders the organic body instead of a pinned shape", () => {
    expect(defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`)).toBe(
      DEFAULT_BOT_AVATAR_COLOR,
    );
    expect(defaultBotAvatarValue("#EAB308::shape_1")).toBe("#EAB308");
    expect(defaultBotAvatarValue("#abc::shape_2")).toBe("#abc");
    expect(defaultBotAvatarValue("#fff")).toBe("#fff");
    expect(defaultBotAvatarValue("data:image/png;base64,abc")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("#zzzzzz::shape_1")).toBe(DEFAULT_BOT_AVATAR_COLOR);
    expect(defaultBotAvatarValue("")).toBe(DEFAULT_BOT_AVATAR_COLOR);

    const restored = renderToString(
      <BotAvatar
        color={defaultBotAvatarValue(`${DEFAULT_BOT_AVATAR_COLOR}::shape_4`)}
        identity="maya"
      />,
    );
    const shaped = renderToString(
      <BotAvatar color={`${DEFAULT_BOT_AVATAR_COLOR}::shape_4`} identity="maya" />,
    );
    expect(restored).toContain("atlas-organic-avatar");
    expect(restored).not.toContain("bot-character-eyes");
    expect(shaped).toContain("bot-character-eyes");
    expect(shaped).toContain("atlas-organic-avatar");
    expect(shaped).toContain("atlas-shape-avatar");
  });

  it("exposes shape picker name and pressed state", () => {
    const html = renderToString(
      <BotShapePreview shapeIndex={0} color="#8B5CF6" selected onClick={() => undefined} />,
    );
    expect(html).toContain('aria-label="hex"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain("focus-visible:ring-2");
  });

  it("previews an organic body when no studio shape is given", () => {
    const html = renderToString(
      <BotShapePreview identity="maya" label="Shape 1" color="#8B5CF6" selected={false} />,
    );
    expect(html).toContain('aria-label="Shape 1"');
    expect(html).toContain("atlas-organic-avatar");
  });

  it("draws every plain-colour bot with the organic body", () => {
    const html = renderToString(<BotAvatar color={DEFAULT_BOT_AVATAR_COLOR} identity="maya" />);
    expect(html).toContain("atlas-organic-avatar");
    expect(html).not.toContain("atlas-bot-avatar-visor");
  });

  it("keeps uploaded images without shape-eye overlays", () => {
    const html = renderToString(<BotAvatar color="data:image/png;base64,abc" identity="maya" />);
    expect(html).toContain("<img");
    expect(html).toContain("atlas-bot-avatar-picture");
    expect(html).not.toContain("atlas-bot-avatar-picture-eyes");
    expect(html).not.toContain("atlas-bot-avatar-picture-goggles");
  });

  it("animates shipped portrait goggles instead of shape eyes", () => {
    const punk = SHIPPED_BOT_AVATAR_IMAGES.find((image) => image.id === "beach-punk")!;
    const html = renderToString(<BotAvatar color={punk.value} identity="maya" />);
    expect(html).toContain("atlas-bot-avatar-picture-goggles");
    expect(html).toContain(punk.goggles);
    expect(html).not.toContain("atlas-bot-avatar-picture-eyes");
  });

  it("keeps an encoded studio shape and animates it like organic", () => {
    const html = renderToString(
      <BotAvatar color={`${DEFAULT_BOT_AVATAR_COLOR}::shape_3`} identity="maya" />,
    );
    expect(html).toContain("bot-character-eyes");
    expect(html).toContain("atlas-organic-avatar");
    expect(html).toContain('data-eye-pattern="');
    expect(html).toContain('data-shape-family="');
    expect(html).toContain("<rect");
    expect(html).not.toContain("<ellipse");
  });

  it("fills the organic body with the resolved palette hex when the custom color is invalid", () => {
    const fallback = resolvePersonaColorDef("maya", "#zzzzzz");
    const html = renderToString(<BotAvatar color="#zzzzzz" identity="maya" />);
    expect(html).toContain("atlas-organic-avatar");
    expect(html).toContain(`fill="${fallback.hex}"`);
    expect(html).not.toContain("#zzzzzz");
  });
});
