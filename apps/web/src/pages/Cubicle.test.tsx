// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, expect, it, vi } from "vitest";

const api = vi.hoisted(() => ({
  bots: { list: vi.fn() },
  runs: { list: vi.fn() },
}));
vi.mock("../lib/rpc", () => ({
  rpc: api,
  rpcForSpace: () => api,
  createSpaceRpc: () => api,
  selectedSpaceId: () => null,
}));
vi.mock("./WindowChrome", () => ({ WindowChrome: () => null }));
vi.mock("@lingui/react/macro", () => {
  const t = (parts: TemplateStringsArray, ...values: unknown[]) =>
    parts.reduce((text, part, index) => text + part + String(values[index] ?? ""), "");
  return { useLingui: () => ({ t }), Trans: ({ children }: { children: ReactNode }) => children };
});
vi.mock("@atlas/ui-web", () => ({
  BotAvatar: () => <span data-testid="bot-avatar" />,
  Button: (props: ComponentProps<"button">) => <button type="button" {...props} />,
  Spinner: (props: ComponentProps<"svg">) => <svg role="status" {...props} />,
}));

import { CubiclePage } from "./Cubicle";

function bot(id: string, name: string, status: string, preview = "") {
  return { id, name, status, preview, runErrorId: null, archivedAt: null, color: "#3EC5A8" };
}

async function renderPage() {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  await act(async () =>
    root.render(
      <QueryClientProvider client={client}>
        <MemoryRouter initialEntries={["/app/cubicle"]}>
          <CubiclePage />
        </MemoryRouter>
      </QueryClientProvider>,
    ),
  );
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  return {
    container,
    async cleanup() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  api.bots.list.mockReset();
  api.runs.list.mockReset();
});

it("shows who needs you first and opens that agent's chat", async () => {
  api.bots.list.mockResolvedValue([
    bot("idle", "Ada", "idle", "Notes filed"),
    bot("wait", "Dora", "waiting_input"),
  ]);
  api.runs.list.mockResolvedValue({
    runs: [
      {
        runId: "run-wait",
        botId: "wait",
        botName: "Dora",
        groupId: null,
        groupName: null,
        threadId: "thread",
        status: "waiting_input",
        trigger: "user",
        notificationsEnabled: false,
        promptSnippet: "Which file should I send?",
        agentMessage: null,
        updatedAt: "2026-11-01T12:00:00.000Z",
      },
    ],
  });
  const page = await renderPage();
  const desks = [...page.container.querySelectorAll("a")].filter((link) =>
    link.getAttribute("data-testid")?.startsWith("cubicle-"),
  );
  expect(desks.map((desk) => desk.getAttribute("data-kind"))).toEqual(["waiting", "idle"]);
  expect(page.container.textContent).toContain("1 needs you");
  expect(page.container.textContent).toContain("Which file should I send?");
  expect(desks[0]?.getAttribute("href")).toBe("/app/wait");
  await page.cleanup();
});
