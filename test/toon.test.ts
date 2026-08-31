// TOON is the tool's output contract: every line an agent reads off stdout is
// either a `key: value` / `name[N]{...}:` header or an indented row. These
// tests hold values that Stripe genuinely returns (free-form descriptions and
// customer names) against that contract.

import { describe, expect, it } from "vitest";
import { emitKV, emitList, parseToon, toonValue } from "../src/output/toon.js";

describe("emitKV", () => {
  it("escapes values so a description with a newline stays one parseable line", () => {
    const out = emitKV([["id", "ch_1"], ["description", "Order 12\nrush"]]);
    expect(out.split("\n")).toHaveLength(2);
    expect(parseToon(out).ok).toBe(true);
    expect(out).toContain('description: "Order 12\\nrush"');
  });

  it("quotes values containing commas or quotes", () => {
    const out = emitKV([["name", 'Doe, "Jane"']]);
    expect(out).toBe('name: "Doe, ""Jane"""');
    expect(parseToon(out).ok).toBe(true);
  });

  it("leaves plain values and empty values untouched", () => {
    expect(emitKV([["status", "succeeded"], ["reason", null]])).toBe("status: succeeded\nreason:");
  });
});

describe("emitList", () => {
  it("keeps one row per line even when a field contains a newline", () => {
    const out = emitList("charges", [{ id: "ch_1", description: "line one\nline two" }], ["id", "description"]);
    expect(out.split("\n")).toHaveLength(2);
    expect(parseToon(out).ok).toBe(true);
  });
});

describe("toonValue", () => {
  it("keeps a backslash distinguishable from an escape it introduces", () => {
    expect(toonValue("a\\nb")).toBe('"a\\\\nb"');
    expect(toonValue("a\nb")).toBe('"a\\nb"');
  });
});

describe("parseToon", () => {
  it("rejects a stray unindented line that is not a header", () => {
    expect(parseToon("id: ch_1\nrush").ok).toBe(false);
  });
});
