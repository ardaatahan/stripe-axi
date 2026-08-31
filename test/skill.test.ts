// SKILL.md is a generated, agent-facing artifact: an agent copies the commands
// out of it verbatim. Every invocation it prints therefore has to name the spec
// this package is actually distributed under, which package.json's repository
// field is the source of truth for. `npm run skill:check` (run in CI) keeps the
// committed file in sync with the generator tested here.

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { renderSkill } from "../src/skill/content.js";

const manifest = JSON.parse(
  readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
);

/** "git+https://github.com/owner/repo.git" -> "github:owner/repo". */
function npmSpecFromRepository(url: string): string {
  const match = /github\.com[/:]([^/]+)\/([^/.]+)/.exec(url);
  expect(match).not.toBeNull();
  return `github:${match![1]}/${match![2]}`;
}

function npxSpecs(text: string): string[] {
  return [...text.matchAll(/npx\s+-y\s+(\S+)/g)].map((m) => m[1]!);
}

describe("generated SKILL.md", () => {
  it("invokes the package by the spec it is distributed under", () => {
    const expected = npmSpecFromRepository(manifest.repository.url);
    const specs = npxSpecs(renderSkill());
    expect(specs.length).toBeGreaterThan(0);
    for (const spec of specs) {
      expect(spec).toBe(expected);
    }
  });

  it("never invokes a bare registry name the package is not published under", () => {
    expect(manifest.publishConfig).toBeUndefined();
    expect(npxSpecs(renderSkill())).not.toContain(manifest.name);
  });
});
