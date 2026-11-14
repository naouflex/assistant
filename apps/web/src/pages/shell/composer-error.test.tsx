// @vitest-environment jsdom

import { i18n } from "@lingui/core";
import { act, createRef } from "react";
import type { Root } from "react-dom/client";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("@lingui/react/macro", () => ({
  useLingui: () => ({
    t: (parts: TemplateStringsArray, ...values: unknown[]) => String.raw(parts, ...values),
  }),
}));

import { ComposerError, runErrorRetryable } from "./composer-error";

let root: Root;
let container: HTMLDivElement;

beforeEach(() => {
  i18n.loadAndActivate({ locale: "en", messages: {} });
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function renderError(runError: string, onRetry?: () => void) {
  act(() =>
    root.render(
      <ComposerError
        sendError={null}
        runError={runError}
        runErrorId="run-1"
        onRunErrorPresented={() => {}}
        onOpenModels={() => {}}
        onOpenConnections={() => {}}
        onDismissError={() => {}}
        onRetry={onRetry}
        textareaRef={createRef<HTMLTextAreaElement>()}
      />,
    ),
  );
  return container.querySelector<HTMLButtonElement>('[data-testid="composer-error-retry"]');
}

it("offers Try again for a failure that retrying can fix", () => {
  const onRetry = vi.fn();
  const retry = renderError('429: {"message":"Too many requests"}', onRetry);
  expect(retry?.textContent).toBe("Try again");
  act(() => retry?.click());
  expect(onRetry).toHaveBeenCalledOnce();
});

it("offers the fix instead of a retry when the key is the problem", () => {
  const retry = renderError('401: {"message":"Invalid API key"}', vi.fn());
  expect(retry).toBeNull();
  expect(container.querySelector('[data-testid="composer-error-action"]')).not.toBeNull();
});

it("shows no retry when there is nothing safe to resend", () => {
  expect(renderError('500: {"message":"Internal error"}')).toBeNull();
});

it("retries only rate limits, provider errors and unusable output", () => {
  expect(runErrorRetryable({})).toBe(true);
  expect(runErrorRetryable({ kind: "rate" })).toBe(true);
  expect(runErrorRetryable({ kind: "output" })).toBe(true);
  expect(runErrorRetryable({ kind: "rate", period: "monthly" })).toBe(false);
  expect(runErrorRetryable({ kind: "credit" })).toBe(false);
  expect(runErrorRetryable({ kind: "output", recovery: "model" })).toBe(false);
  expect(runErrorRetryable(null)).toBe(false);
});
