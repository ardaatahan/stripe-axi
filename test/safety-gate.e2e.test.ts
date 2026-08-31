// End-to-end proof of the safety model, run against the real built binary
// (no mocking) exactly as an agent or the captain would invoke it. This test
// environment genuinely has no `stripe` binary on PATH, which is what makes
// this a real proof rather than an assertion about internal call counts:
//
//   - dry-run (no --confirm) must NEVER reach the point of invoking `stripe`
//     — if it did, stdout would contain the "Stripe CLI is not installed"
//     error instead of a dry-run plan.
//   - a LIVE-mode write with --confirm alone must be refused before ever
//     trying to invoke `stripe` — same absence-of-install-error check.
//   - a LIVE-mode write with --confirm AND --i-understand-this-is-live must
//     actually attempt to shell out (and fail cleanly, since `stripe` isn't
//     installed here) — proving the gate does let fully-acknowledged writes
//     through to real execution.

import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/stripe-axi.js", import.meta.url));

function run(env: Record<string, string>, ...args: string[]) {
  return spawnSync("node", [bin, ...args], { encoding: "utf8", env: { ...process.env, ...env } });
}

const TEST_KEY = "sk_test_FIXTUREKEY1234567890";
const LIVE_KEY = "sk_live_FIXTUREKEY1234567890";

const NOT_INSTALLED_MARKER = "is not installed or not on PATH";

interface GatedCase {
  label: string;
  args: string[];
}

const GATED_COMMANDS: GatedCase[] = [
  { label: "charge capture", args: ["charge", "capture", "ch_123"] },
  { label: "payment capture", args: ["payment", "capture", "pi_123"] },
  { label: "payment cancel", args: ["payment", "cancel", "pi_123"] },
  { label: "customer add", args: ["customer", "add", "--email", "a@example.com"] },
  { label: "customer rm", args: ["customer", "rm", "cus_123"] },
  { label: "subscription cancel", args: ["subscription", "cancel", "sub_123"] },
  { label: "invoice void", args: ["invoice", "void", "in_123"] },
  { label: "refund", args: ["refund", "ch_123"] },
  { label: "payout create", args: ["payout", "create", "--amount", "1000"] },
  { label: "product update", args: ["product", "update", "prod_123", "--active", "true"] },
  { label: "price update", args: ["price", "update", "price_123", "--active", "true"] },
  { label: "checkout create", args: ["checkout", "create", "--price", "price_123", "--success-url", "https://example.com/s"] },
  { label: "payment-link create", args: ["payment-link", "create", "--price", "price_123"] },
];

describe("safety gate: dry-run by default (no --confirm)", () => {
  it.each(GATED_COMMANDS)("$label never shells out to stripe without --confirm", ({ args }) => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, ...args);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dry-run:");
    expect(r.stdout).not.toContain(NOT_INSTALLED_MARKER);
    expect(r.stdout).toMatch(/re-run with --confirm/);
  });
});

describe("safety gate: LIVE mode requires a second acknowledgement", () => {
  it.each(GATED_COMMANDS)("$label refuses --confirm alone in LIVE mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: LIVE_KEY }, ...args, "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("--confirm alone is not enough");
    expect(r.stdout).toContain("--i-understand-this-is-live");
    expect(r.stdout).not.toContain(NOT_INSTALLED_MARKER);
  });

  it.each(GATED_COMMANDS)("$label proceeds to real execution once fully acknowledged in LIVE mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: LIVE_KEY }, ...args, "--confirm", "--i-understand-this-is-live");
    // stripe isn't installed in this environment, so full acknowledgement
    // must reach the point of trying to shell out and fail there — proving
    // the gate actually opens rather than silently no-opping.
    expect(r.stdout).toContain(NOT_INSTALLED_MARKER);
    expect(r.status).toBe(1);
  });
});

describe("safety gate: TEST mode only needs --confirm", () => {
  it.each(GATED_COMMANDS)("$label attempts real execution with --confirm alone in TEST mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, ...args, "--confirm");
    expect(r.stdout).toContain(NOT_INSTALLED_MARKER);
    expect(r.status).toBe(1);
  });
});

describe("safety gate: read commands never require --confirm", () => {
  it("balance runs read-only without any confirmation flags", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "balance");
    // No stripe binary, so it fails at the API call — but it must get that
    // far without ever mentioning --confirm or dry-run.
    expect(r.stdout).toContain(NOT_INSTALLED_MARKER);
    expect(r.stdout).not.toContain("dry-run");
  });
});

describe("no key present", () => {
  it("gives a structured, non-crashing error naming what to set", () => {
    const r = run({ STRIPE_API_KEY: "" }, "balance");
    expect(r.stdout).toMatch(/no Stripe API key found/);
    expect(r.stdout).toContain("STRIPE_API_KEY");
    expect(r.status).toBe(1);
  });
});
