// @vitest-environment jsdom

import type { BotAvatarSet } from "@atlas/contracts";
import { botAvatarWordValue } from "@atlas/contracts";
import { DEFAULT_BOT_AVATAR_COLOR } from "@atlas/ui-web";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

import { AvatarStudioPopover } from "./avatar-studio-popover";

let container: HTMLDivElement;
let root: Root;
const changed = vi.fn<(value: string, avatarSet?: BotAvatarSet) => void>();

function Harness({
  value: initial,
  avatarSet: initialSet,
}: {
  value: string;
  avatarSet?: BotAvatarSet;
}) {
  const [value, setValue] = useState(initial);
  const [avatarSet, setAvatarSet] = useState(initialSet);
  return (
    <AvatarStudioPopover
      value={value}
      identity="sample-bot"
      avatarSet={avatarSet}
      onChange={(next, nextSet) => {
        changed(next, nextSet);
        setValue(next);
        if (nextSet !== undefined) setAvatarSet(nextSet);
      }}
    />
  );
}

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  window.matchMedia ??= ((query: string) => ({
    matches: false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as typeof window.matchMedia;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  changed.mockClear();
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});
function button(name: string) {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find(
    (node) => node.getAttribute("aria-label") === name || node.textContent === name,
  );
  if (!found) throw new Error(`Missing button ${name}`);
  return found;
}
async function click(name: string) {
  await act(async () => button(name).click());
}
async function render(value: string, avatarSet?: BotAvatarSet, key = "initial") {
  await act(async () => root.render(<Harness key={key} value={value} avatarSet={avatarSet} />));
}

describe("selectable bot icon sets", () => {
  it("keeps a legacy appearance on open, saves an Atlas switch, and restores the saved set on reload", async () => {
    await render("#10B981");
    await click("Customize bot avatar");
    expect(button("Original").getAttribute("aria-selected")).toBe("true");
    expect(document.querySelector(".atlas-organic-avatar")).not.toBeNull();
    expect(changed).not.toHaveBeenCalled();
    await click("Atlas");
    expect(changed).toHaveBeenLastCalledWith("#10B981", "atlas");
    expect(document.querySelector(".atlas-logo-avatar")).not.toBeNull();
    await render("#10B981", "atlas", "reload");
    await click("Customize bot avatar");
    expect(button("Atlas").getAttribute("aria-selected")).toBe("true");
    await click("Original");
    expect(changed).toHaveBeenLastCalledWith("#10B981", "organic");
    expect(document.querySelector(".atlas-organic-avatar")).not.toBeNull();
    expect(button("wedge")).toBeDefined();
  });

  it("leaves a photo intact until the user explicitly selects another set", async () => {
    const photo = "data:image/png;base64,abc";
    await render(photo);
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    expect(document.querySelector(`img[src="${photo}"]`)).not.toBeNull();
    await click("Atlas");
    expect(changed).toHaveBeenLastCalledWith(DEFAULT_BOT_AVATAR_COLOR, "atlas");
    expect(document.querySelector(`img[src="${photo}"]`)).toBeNull();
  });

  it("keeps explicit original shapes and their chosen set while changing colour", async () => {
    await render("#8B5CF6::shape_2", "organic");
    await click("Customize bot avatar");
    expect(changed).not.toHaveBeenCalled();
    await click("Color #10B981");
    expect(changed).toHaveBeenLastCalledWith("#10B981::shape_2", undefined);
    expect(button("Original").getAttribute("aria-selected")).toBe("true");
    await click("Atlas");
    expect(changed).toHaveBeenLastCalledWith("#10B981", "atlas");
  });

  it("generates a shape from a word and keeps it when the color changes", async () => {
    await render("#8B5CF6");
    await click("Customize bot avatar");
    const input = document.querySelector<HTMLInputElement>('[data-testid="avatar-word"]');
    expect(input).not.toBeNull();
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "River");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await click("Generate");
    const river = botAvatarWordValue("#8B5CF6", "river");
    expect(changed).toHaveBeenLastCalledWith(river, undefined);
    await click("Color #10B981");
    expect(changed).toHaveBeenLastCalledWith(botAvatarWordValue("#10B981", "river"), undefined);
  });

  it("applies a shipped custom picture from the bot tab", async () => {
    await render("#8B5CF6");
    await click("Customize bot avatar");
    const preset = document.querySelector<HTMLButtonElement>(
      '[data-testid="avatar-studio-custom-beach-punk"]',
    );
    expect(preset).not.toBeNull();
    await act(async () => preset!.click());
    expect(changed).toHaveBeenCalled();
    const [next] = changed.mock.calls.at(-1)!;
    expect(next.startsWith("data:image/webp;base64,")).toBe(true);
    const preview = document.querySelector<HTMLImageElement>(".atlas-bot-avatar-picture img");
    expect(preview?.getAttribute("src")).toBe(next);
    expect(preset!.getAttribute("aria-pressed")).toBe("true");
  });
});
