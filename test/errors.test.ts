// Errors are part of the stdout TOON contract (AXI principle 6): an agent
// parses them the same way it parses results, so a message coming back from
// the Stripe CLI must not be able to break the shape.

import { describe, expect, it } from "vitest";
import { AxiError, UsageError, renderError } from "../src/output/errors.js";
import { parseToon } from "../src/output/toon.js";

describe("renderError", () => {
  it("keeps a multi-line CLI message on one parseable line", () => {
    const stderr = "Error: unknown flag: --confirm\nUsage:\n  stripe post <path> [flags]";
    const rendered = renderError(new AxiError("the Stripe CLI exited with code 1", stderr));
    expect(rendered.split("\n")).toHaveLength(2);
    expect(parseToon(rendered).ok).toBe(true);
    expect(rendered).toContain("Usage:");
  });

  it("quotes a message containing commas or quotes", () => {
    const rendered = renderError(new AxiError('no such charge: "ch_1", check the ID'));
    expect(parseToon(rendered).ok).toBe(true);
    expect(rendered.split("\n")).toHaveLength(1);
  });

  it("leaves an ordinary message unquoted", () => {
    expect(renderError(new UsageError("unknown flag --nope", "valid flags: --limit"))).toBe(
      "error: unknown flag --nope\nsuggestion: valid flags: --limit",
    );
  });
});
