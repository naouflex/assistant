import { describe, expect, it } from "vitest";
import {
  DEFAULT_LLAMA_RELEASE,
  DEFAULT_MODEL_ID,
  cudartZipUrl,
  hostRoot,
  isWindowsNativeHostSupported,
  llamaReleaseTag,
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
});
