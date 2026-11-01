import { describe, expect, it } from "vitest";
import {
  cudartZipUrl,
  DEFAULT_LLAMA_RELEASE,
  DEFAULT_MODEL_ID,
  hostRoot,
  isWindowsNativeHostSupported,
  LOCAL_MODEL_CATALOG,
  llamaReleaseTag,
  localModelRouterPreset,
  modelsDir,
  runtimeDir,
  runtimeZipUrl,
  serverPort,
} from "./local-model-host.js";

describe("local model host helpers", () => {
  it("pins the CUDA 12.4 Windows runtime URLs", () => {
    expect(llamaReleaseTag({})).toBe(DEFAULT_LLAMA_RELEASE);
    expect(llamaReleaseTag({ ATLAS_LLAMA_RELEASE: "b9999" })).toBe("b9999");
    expect(runtimeZipUrl("b12032")).toContain("llama-b12032-bin-win-cuda-12.4-x64.zip");
    expect(cudartZipUrl("b12032")).toContain("cudart-llama-bin-win-cuda-12.4-x64.zip");
  });

  it("keeps models under the app userData tree", () => {
    expect(hostRoot("/data/Atlas")).toBe("/data/Atlas/llama-host");
    expect(modelsDir(hostRoot("/data/Atlas"))).toBe("/data/Atlas/llama-host/models");
    expect(runtimeDir(hostRoot("/data/Atlas"))).toBe("/data/Atlas/llama-host/runtime");
  });

  it("defaults the OpenAI-compatible port and only supports Windows x64", () => {
    expect(serverPort({})).toBe(11436);
    expect(serverPort({ ATLAS_LOCAL_MODELS_PORT: "12000" })).toBe(12000);
    expect(isWindowsNativeHostSupported("win32", "x64")).toBe(true);
    expect(isWindowsNativeHostSupported("linux", "x64")).toBe(false);
    expect(DEFAULT_MODEL_ID).toBe("qwen3.5:4b-mtp");
  });

  it("serves Qwen and the Spark 4B models from one router preset", () => {
    expect(LOCAL_MODEL_CATALOG.map((entry) => entry.id)).toEqual([
      "qwen3.5:4b-mtp",
      "qwen3.5:9b",
      "qwen3.8:9b",
      "spark-x2.5:4b",
      "spark-x2.6:4b",
    ]);
    const preset = localModelRouterPreset("/models", () => false);
    expect(preset).toContain("[qwen3.5:4b]");
    expect(preset).toContain("alias = qwen3.5:4b,qwen3.5:4b-mtp");
    expect(preset).toContain("[qwen3.5:9b]");
    expect(preset).toContain("alias = qwen3.5:9b,qwen3.5:9b-text");
    expect(preset).toContain("/models/Qwen3.5-9B-Q4_K_M.gguf");
    expect(preset).toContain("[qwen3.8:9b]");
    expect(preset).toContain("alias = qwen3.8:9b");
    expect(preset).toContain("/models/Qwen3.8-9B-Q4_K_M.gguf");
    expect(preset).toContain("spec-type = draft-mtp");
    expect(preset).toContain("[spark-x2.5:4b]");
    expect(preset).toContain("/models/Spark-X2.5-4B-Q4_K_M.gguf");
    expect(preset).toContain("[spark-x2.6:4b]");
    expect(preset).toContain("/models/Spark-X2.6-4B-Q4_K_M.gguf");
    expect(preset).toContain("reasoning = off");
    expect(preset).toContain("no-reasoning-preserve = true");
    expect(preset).not.toContain("load-on-startup");
    const ready = localModelRouterPreset("/models", () => true);
    const answer = ready.split("[qwen3.5:9b]")[1]?.split("\n[")[0] ?? "";
    expect(answer).toContain("load-on-startup = true");
    const fast = ready.split("[qwen3.5:4b]")[1]?.split("\n[")[0] ?? "";
    expect(fast).not.toContain("load-on-startup");
    expect(preset).not.toContain("mmproj");
    expect(localModelRouterPreset("/models", () => true)).toContain("mmproj-Qwen3.5-4B-F16.gguf");
  });
});
