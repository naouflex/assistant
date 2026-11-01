// @vitest-environment jsdom
import type { ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => {
  const t = (strings: TemplateStringsArray, ...values: unknown[]) =>
    strings.reduce((text, part, index) => text + part + (values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("./message-cards", () => ({
  ChartCanvas: () => <div data-testid="chart-canvas" />,
}));

import { ChartSideView } from "./artifact-panel";

let root: ReturnType<typeof createRoot> | undefined;
let container: HTMLDivElement;

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  if (root) await act(async () => root?.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

it("renders a chart beside chat by name", async () => {
  await act(async () =>
    root?.render(
      <ChartSideView chart={{ name: "Sales", spec: { marks: [] }, data: [{ x: 1 }] }} />,
    ),
  );
  expect(container.querySelector("h2")?.textContent).toBe("Sales");
  expect(container.querySelector('[data-testid="chart-canvas"]')).not.toBeNull();
});
