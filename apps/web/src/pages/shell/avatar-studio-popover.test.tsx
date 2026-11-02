// @vitest-environment jsdom

import type { BotAvatarSet } from "@atlas/contracts";
import { botAvatarWordValue } from "@atlas/contracts";
import { DEFAULT_BOT_AVATAR_COLOR } from "@atlas/ui-web";
import { i18n } from "@lingui/core";
import { I18nProvider } from "@lingui/react";
import type { ReactNode } from "react";
import { act, useState } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  Trans: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@lingui/core/macro", () => ({
  t: (parts: TemplateStringsArray) => parts[0] ?? "",
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
    <I18nProvider i18n={i18n}>
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
    </I18nProvider>
  );
}

beforeEach(() => {
  i18n.load("en", {});
  i18n.activate("en");
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
    const studio = document.querySelector("[data-testid='avatar-studio']");
    expect(studio?.querySelector(".atlas-word-icon")?.textContent).toBe("R");
    expect(studio?.querySelector(".atlas-bot-avatar")?.textContent).toContain("R");
    expect(changed).not.toHaveBeenCalled();
    await act(async () => {
      input!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    });
    const river = botAvatarWordValue("#8B5CF6", "river");
    expect(changed).toHaveBeenLastCalledWith(river, undefined);
    expect(input!.value).toBe("river");
    expect(input!.dataset.selected).toBe("true");
    await click("Color #10B981");
    expect(changed).toHaveBeenLastCalledWith(botAvatarWordValue("#10B981", "river"), undefined);
    await click("wedge");
    expect(input!.value).toBe("");
    expect(document.querySelector("[data-testid='avatar-studio'] .atlas-word-icon")).toBeNull();
  });

  it("shows shapes on Atlas and switches to Original when one is picked", async () => {
    await render("#10B981", "atlas");
    await click("Customize bot avatar");
    expect(button("wedge")).toBeDefined();
    await click("wedge");
    expect(changed.mock.calls.at(-1)?.[0]).toMatch(/^#10B981::shape_\d+$/);
    expect(changed).toHaveBeenLastCalledWith(expect.any(String), "organic");
  });

  it("commits a typed word when closing the studio without Apply", async () => {
    await render("#8B5CF6");
    await click("Customize bot avatar");
    const input = document.querySelector<HTMLInputElement>('[data-testid="avatar-word"]');
    await act(async () => {
      const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      setValue?.call(input, "anchor");
      input!.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(changed).not.toHaveBeenCalled();
    await click("Close");
    const anchor = botAvatarWordValue("#8B5CF6", "anchor");
    expect(changed).toHaveBeenLastCalledWith(anchor, undefined);
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
