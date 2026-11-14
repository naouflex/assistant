import { existsSync, readFileSync } from "node:fs";
import { atlasPublicDoc } from "@atlas/contracts";
import { describe, expect, it } from "vitest";
import { ATLAS_DOCS_URLS, BUILTIN_AGENT_SKILLS } from "./builtin-skills.js";

const repoFile = (path: string) => new URL(`../../../${path}`, import.meta.url);
const publishedSlugs = [
  ...readFileSync(repoFile("apps/www/src/docs.ts"), "utf8").matchAll(/slug: "([\w-]+)"/g),
].map((match) => match[1]);

describe("Atlas skill", () => {
  it("links only to published docs pages", () => {
    const skill = BUILTIN_AGENT_SKILLS.find((s) => s.name === "Atlas")!;
    const urls = [...skill.content.matchAll(/https?:\/\/\S+/g)].map((match) => match[0]);
    expect(urls).toEqual(ATLAS_DOCS_URLS);
    for (const url of urls) {
      const slug =
        url === atlasPublicDoc("docs.md")
          ? publishedSlugs[0]
          : new RegExp(
              `^${atlasPublicDoc("docs/").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}([\\w-]+)\\.md$`,
            ).exec(url)?.[1];
      expect(publishedSlugs, url).toContain(slug);
      expect(existsSync(repoFile(`docs/${slug}.md`)), url).toBe(true);
    }
  });
});
