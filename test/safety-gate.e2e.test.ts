// End-to-end proof of the safety model, run against the real built binary
// (no mocking) exactly as a user would invoke it.
//
// The `stripe` the binary finds is a stub script this file writes and puts
// first on PATH: it logs every invocation and answers with a canned JSON
// object. That makes each assertion about a real, observable side effect
// (did stripe-axi actually shell out?) rather than about the accidental
// absence of the Stripe CLI on the machine running the suite:
//
//   - dry-run (no --confirm) must NEVER invoke `stripe` — the stub's
//     invocation log must stay empty.
//   - a LIVE-mode write with --confirm alone must be refused before ever
//     invoking `stripe` — same empty-log check.
//   - a LIVE-mode write with --confirm AND --i-understand-this-is-live must
//     actually reach the CLI — proving the gate opens rather than silently
//     no-opping.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/stripe-axi.js", import.meta.url));

// Stands in for the official Stripe CLI: records the arguments it was called
// with, then answers with one JSON object carrying every field the command
// renderers read. `created` is now, so a fresh execution is never mistaken
// for an idempotent replay; STRIPE_AXI_STUB_OLD_CREATED backdates it to
// simulate Stripe replaying a stored response for a repeated key.
const STUB = `#!/bin/sh
if [ -n "$STRIPE_AXI_STUB_LOG" ]; then
  printf '%s\\n' "$*" >> "$STRIPE_AXI_STUB_LOG"
  printf 'key=%s\\n' "\${STRIPE_API_KEY:-none}" >> "$STRIPE_AXI_STUB_LOG"
fi
created=$(date +%s)
if [ -n "$STRIPE_AXI_STUB_OLD_CREATED" ]; then
  created=$((created - 86400))
fi
printf '{"id":"obj_stub_1","object":"stub","created":%s,"amount":500,"amount_captured":500,"currency":"usd","status":"succeeded","active":true,"deleted":true,"url":"https://example.com/stub","email":"stub@example.com","cancel_at_period_end":false,"available":[{"amount":1000,"currency":"usd"}],"data":[]}\\n' "$created"
`;

const sandbox = mkdtempSync(join(tmpdir(), "stripe-axi-e2e-"));
const stubDir = join(sandbox, "bin");
mkdirSync(stubDir, { recursive: true });
writeFileSync(join(stubDir, "stripe"), STUB, { mode: 0o755 });
// The stub goes FIRST on PATH, so it shadows a real Stripe CLI if the
// machine running the suite has one installed.
const stubPath = stubDir + delimiter + (process.env.PATH ?? "");

// A directory with no `stripe` in it at all, for the not-installed path.
const emptyDir = join(sandbox, "empty");
mkdirSync(emptyDir, { recursive: true });

afterAll(() => rmSync(sandbox, { recursive: true, force: true }));

const TEST_KEY = "sk_test_FIXTUREKEY1234567890";
const LIVE_KEY = "sk_live_FIXTUREKEY1234567890";

let runCount = 0;

interface RunOptions {
  /** PATH the binary sees; defaults to the stub directory only. */
  path?: string;
  /** Backdate the stub's `created` to simulate an idempotent replay. */
  oldCreated?: boolean;
}

function runWith(env: Record<string, string>, opts: RunOptions, args: string[]) {
  const log = join(sandbox, `invocations-${runCount++}.log`);
  const result = spawnSync(process.execPath, [bin, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      // HOME is redirected so a developer's real ~/.config/stripe-axi/credentials
      // can never leak into these assertions.
      HOME: sandbox,
      PATH: opts.path ?? stubPath,
      STRIPE_AXI_STUB_LOG: log,
      STRIPE_AXI_STUB_OLD_CREATED: opts.oldCreated ? "1" : "",
      ...env,
    },
  });
  const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return {
    ...result,
    /** Argument lines the stub `stripe` was invoked with, one per call. */
    invocations: lines.filter((l) => !l.startsWith("key=")),
    /** The STRIPE_API_KEY each invocation saw in its environment. */
    keysSeen: lines.filter((l) => l.startsWith("key=")).map((l) => l.slice(4)),
  };
}

function run(env: Record<string, string>, ...args: string[]) {
  return runWith(env, {}, args);
}

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
    expect(r.invocations).toEqual([]);
    expect(r.stdout).toMatch(/re-run with --confirm/);
  });

  it("prints the equivalent command without ever exposing the key", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_123", "--amount", "500");
    expect(r.stdout).toContain("STRIPE_API_KEY=<redacted> stripe post /v1/refunds");
    expect(r.stdout).not.toContain(TEST_KEY);
  });
});

describe("safety gate: LIVE mode requires a second acknowledgement", () => {
  it.each(GATED_COMMANDS)("$label refuses --confirm alone in LIVE mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: LIVE_KEY }, ...args, "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("--confirm alone is not enough");
    expect(r.stdout).toContain("--i-understand-this-is-live");
    expect(r.invocations).toEqual([]);
  });

  it.each(GATED_COMMANDS)("$label proceeds to real execution once fully acknowledged in LIVE mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: LIVE_KEY }, ...args, "--confirm", "--i-understand-this-is-live");
    expect(r.status).toBe(0);
    expect(r.invocations).toHaveLength(1);
    expect(r.invocations[0]).toMatch(/^(post|delete) \/v1\//);
    expect(r.stdout).toContain("obj_stub_1");
  });
});

describe("safety gate: TEST mode only needs --confirm", () => {
  it.each(GATED_COMMANDS)("$label attempts real execution with --confirm alone in TEST mode", ({ args }) => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, ...args, "--confirm");
    expect(r.status).toBe(0);
    expect(r.invocations).toHaveLength(1);
    expect(r.invocations[0]).toMatch(/^(post|delete) \/v1\//);
  });
});

describe("the API key reaches the Stripe CLI through its environment, not argv", () => {
  it("passes the key in STRIPE_API_KEY and never as a command-line argument", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "balance");
    expect(r.keysSeen).toEqual([TEST_KEY]);
    expect(r.invocations.join("\n")).not.toContain(TEST_KEY);
  });
});

describe("idempotent-replay labelling", () => {
  it("labels a creation whose stored response is replayed by Stripe", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { oldCreated: true }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("REPLAY of a prior identical operation (not freshly executed)");
    expect(r.stdout).toContain("refunded: obj_stub_1");
  });

  it("says nothing about replays when the object was freshly created", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_123", "--amount", "500", "--confirm");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("refunded: obj_stub_1");
    expect(r.stdout).not.toContain("REPLAY");
  });

  it("does not label a capture, whose response predates the request by design", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { oldCreated: true }, ["charge", "capture", "ch_123", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("captured: charge obj_stub_1");
    expect(r.stdout).not.toContain("REPLAY");
  });
});

describe("safety gate: read commands never require --confirm", () => {
  it("balance runs read-only without any confirmation flags", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "balance");
    expect(r.status).toBe(0);
    expect(r.invocations).toEqual(["get /v1/balance --color off"]);
    expect(r.stdout).not.toContain("dry-run");
  });
});

describe("the Stripe CLI is missing", () => {
  it("reports the install hint instead of crashing", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { path: emptyDir }, ["balance"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("is not installed or not on PATH");
    expect(r.stdout).toContain("brew install stripe/stripe-cli/stripe");
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
