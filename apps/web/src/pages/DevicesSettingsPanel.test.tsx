// @vitest-environment jsdom
import { ANDROID_APK_URL } from "@atlas/contracts";
import type { ComponentProps, ReactNode } from "react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DevicesSettingsPanel } from "./DevicesSettingsPanel";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (strings: TemplateStringsArray, ...values: unknown[]) =>
      strings.reduce((text, part, index) => text + part + (values[index] ?? ""), ""),
  }),
  Trans: ({ children }: { children: ReactNode }) => children,
}));
vi.mock("@atlas/ui-web", () => ({
  Button: ({
    variant: _variant,
    size: _size,
    ...props
  }: ComponentProps<"button"> & { variant?: string; size?: string }) => <button {...props} />,
}));
vi.mock("../components/ComputerDeviceSettings", () => ({
  ComputerDeviceSettings: ({ alwaysShow }: { alwaysShow?: boolean }) => (
    <div data-testid="computer-devices">{alwaysShow ? "computers" : null}</div>
  ),
}));
vi.mock("../lib/query", () => ({
  useSpaceQueries: () => ({
    models: {
      localStatus: {
        queryOptions: () => ({ queryKey: ["localStatus"], queryFn: async () => undefined }),
        queryKey: () => ["localStatus"],
        call: vi.fn(),
      },
      list: { key: () => ["models"] },
    },
  }),
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: () => ({
    data: {
      contextWindow: 16384,
      checkedAt: new Date().toISOString(),
      servers: [
        {
          baseUrl: "http://127.0.0.1:11436/v1",
          kind: "llama-server",
          reachable: true,
          contextWindow: 16384,
          models: [{ id: "qwen", aliases: [], sizeBytes: null, parameterSize: null, contextWindow: 16384, large: false, loadState: "unloaded" }],
        },
      ],
    },
  }),
  useQueryClient: () => ({ setQueryData: vi.fn(), invalidateQueries: vi.fn() }),
}));

let host: HTMLDivElement;
let root: ReturnType<typeof createRoot>;

beforeEach(() => {
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
  vi.stubGlobal(
    "fetch",
    vi.fn(async () => ({ ok: true }) as Response),
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

it("lists the server, local models, computers, and phone", async () => {
  await act(async () => root.render(<DevicesSettingsPanel />));
  expect(host.querySelector('[data-testid="devices-settings"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="devices-server"]')?.textContent).toContain("Online");
  expect(host.querySelector('[data-testid="devices-models"]')?.textContent).toContain("127.0.0.1:11436");
  expect(host.querySelector('[data-testid="devices-models"]')?.textContent).toContain("qwen");
  expect(host.querySelector('[data-testid="devices-models"]')?.textContent).toContain("Not loaded");
  expect(host.querySelector('[data-testid="devices-model-load-qwen"]')).not.toBeNull();
  expect(host.querySelector('[data-testid="computer-devices"]')?.textContent).toBe("computers");
  const qr = host.querySelector('[data-testid="devices-apk-qr"]');
  expect(qr?.getAttribute("href")).toBe(ANDROID_APK_URL);
  expect(qr?.textContent).toContain("Install Atlas and sign in");
  await vi.waitFor(() => {
    expect(host.querySelector('[data-testid="devices-apk-qr-mark"] path')?.getAttribute("d")).toBeTruthy();
  });
});
