import { describe, expect, it } from "vitest";
import { partitionTools } from "./builtin-tool-bridge.js";
import { focusTurnTools } from "./run-tool-selection.js";

describe("focusTurnTools", () => {
  const tools = Array.from({ length: 20 }, (_, index) => ({
    name: index === 0 ? "shell" : index === 1 ? "web_search" : `browser_step_${index}`,
    description: index > 2 ? "browse a page" : "everyday",
    inputSchema: {},
  }));

  it("lists about a dozen tools and defers the rest behind search", () => {
    const focused = focusTurnTools(tools, { prompt: "open the browser and snapshot the page" });
    const { listed, deferred } = partitionTools(focused);
    const names = listed
      .map((tool) => tool.name)
      .filter((name) => name !== "find_tool" && name !== "use_tool");
    expect(names.length).toBeGreaterThanOrEqual(8);
    expect(names.length).toBeLessThanOrEqual(12);
    expect(names).toContain("shell");
    expect(names).toContain("web_search");
    expect(deferred.length).toBeGreaterThan(0);
    expect(listed.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["find_tool", "use_tool"]),
    );
  });

  it("matches French words that carry accents", () => {
    const focused = focusTurnTools(
      [
        ...tools,
        { name: "search_memory", description: "Search memory notes", inputSchema: {} },
        { name: "read_file", description: "Read a file", inputSchema: {} },
      ],
      { prompt: "Cherche dans la mémoire et lis le fichier" },
    );
    const listed = focused.filter((tool) => !tool.deferred).map((tool) => tool.name);
    expect(listed).toContain("search_memory");
    expect(listed).toContain("read_file");
  });

  it("keeps a short list whole", () => {
    const few = tools.slice(0, 6);
    expect(focusTurnTools(few, { prompt: "hello" })).toEqual(few);
  });
});
