// End-to-end proof of the safety model, run against the real built binary
// (no mocking) exactly as a user would invoke it.
//
// The `stripe` the binary finds is a stub script this file writes and puts
// first on PATH: it logs every invocation and answers with a canned JSON
// object. That makes each assertion about a real, observable side effect
// (did stripe-axi actually shell out?) rather than about the accidental
// absence of the Stripe CLI on the machine running the suite:
//
//   - dry-run (no --confirm) must NEVER invoke `stripe` - the stub's
//     invocation log must stay empty.
//   - a LIVE-mode write with --confirm alone must be refused before ever
//     invoking `stripe` - same empty-log check.
//   - a LIVE-mode write with --confirm AND --i-understand-this-is-live must
//     actually reach the CLI - proving the gate opens rather than silently
//     no-opping.

import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";
import { parseToon } from "../src/output/toon.js";

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
if [ -n "$STRIPE_AXI_STUB_REPLAY_HEADER" ]; then
  printf '< Request-Id: req_stub\n' >&2
  if [ "$STRIPE_AXI_STUB_REPLAY_HEADER" != "absent" ]; then
    printf '< Idempotency-Replayed: %s\n' "$STRIPE_AXI_STUB_REPLAY_HEADER" >&2
  fi
fi
if [ -n "$STRIPE_AXI_STUB_FAIL" ]; then
  case " $* " in
    *" --show-headers "*)
      printf '> POST https://api.stripe.com/v1/refunds\n' >&2
      printf '> Authorization: Bearer [REDACTED]\n' >&2
      printf '> Idempotency-Key: stripe-axi_refund.create_47942a952b6c7cf2f89310eb5f86299b642d9e52\n' >&2
      printf '< HTTP 401\n' >&2
      printf '< Request-Id: req_stub\n' >&2
      printf 'Error: Invalid API Key provided: sk_test_***********************XYZ\n' >&2
      ;;
    *)
      printf 'Error: unknown flag: --nope\nUsage:\n  stripe post <path> [flags]\n' >&2
      ;;
  esac
  exit 1
fi
if [ -n "$STRIPE_AXI_STUB_FAIL_TRACE_ONLY" ]; then
  printf '> POST https://api.stripe.com/v1/refunds\n' >&2
  printf '> Authorization: Bearer [REDACTED]\n' >&2
  printf '< HTTP 401\n' >&2
  printf '< Request-Id: req_stub\n' >&2
  exit 1
fi
data='[]'
if [ -n "$STRIPE_AXI_STUB_LIST_ROWS" ]; then
  data='[{"id":"ch_stub_1","amount":500,"currency":"usd","status":"succeeded","created":'"$created"'}]'
fi
if [ -n "$STRIPE_AXI_STUB_BIG_LIST" ]; then
  pad=$(awk 'BEGIN{s="";while(length(s)<2000)s=s "x";print s}')
  rows=""
  sep=""
  i=0
  while [ $i -lt 100 ]; do
    rows="$rows$sep"'{"id":"ch_big_'"$i"'","amount":500,"currency":"usd","status":"succeeded","created":'"$created"',"description":"'"$pad"'"}'
    sep=","
    i=$((i+1))
  done
  data="[$rows]"
fi
more=false
if [ -n "$STRIPE_AXI_STUB_HAS_MORE" ]; then
  more=true
fi
printf '{"id":"obj_stub_1","object":"stub","created":%s,"amount":500,"amount_captured":500,"currency":"usd","status":"succeeded","active":true,"deleted":true,"url":"https://example.com/stub","email":"stub@example.com","cancel_at_period_end":false,"available":[{"amount":1000,"currency":"usd"}],"has_more":%s,"data":%s}\\n' "$created" "$more" "$data"
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
  /** Make the stub answer list requests with one row instead of none. */
  listRows?: boolean;
  /** Make the stub fail with a multi-line cobra-style usage error. */
  fail?: boolean;
  /** Make the stub fail writing nothing but a request/response trace. */
  failTraceOnly?: boolean;
  /** Value of the Idempotency-Replayed response header, or "absent" to omit it. */
  replayHeader?: "true" | "false" | "absent";
  /** Make list responses report has_more. */
  hasMore?: boolean;
  /** Make list responses ~200KB, to exercise stdout flushing. */
  bigList?: boolean;
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
      STRIPE_AXI_STUB_LIST_ROWS: opts.listRows ? "1" : "",
      STRIPE_AXI_STUB_FAIL: opts.fail ? "1" : "",
      STRIPE_AXI_STUB_FAIL_TRACE_ONLY: opts.failTraceOnly ? "1" : "",
      STRIPE_AXI_STUB_REPLAY_HEADER: opts.replayHeader ?? "",
      STRIPE_AXI_STUB_HAS_MORE: opts.hasMore ? "1" : "",
      STRIPE_AXI_STUB_BIG_LIST: opts.bigList ? "1" : "",
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

/** Runs a printed dry-run command line through a real shell against the stub. */
function runShell(command: string) {
  const log = join(sandbox, `invocations-${runCount++}.log`);
  const result = spawnSync("/bin/sh", ["-c", command], {
    encoding: "utf8",
    env: { ...process.env, HOME: sandbox, PATH: stubPath, STRIPE_AXI_STUB_LOG: log },
  });
  const lines = existsSync(log) ? readFileSync(log, "utf8").split("\n").filter(Boolean) : [];
  return { ...result, invocations: lines.filter((l) => !l.startsWith("key=")) };
}

/**
 * The `stripe ...` line of a dry-run plan, with the redacted key placeholder
 * filled in - the one substitution a user makes before pasting it.
 */
function dryRunCommand(stdout: string): string {
  const line = stdout.split("\n").find((l) => l.trim().startsWith("STRIPE_API_KEY=<redacted>"));
  expect(line).toBeDefined();
  return line!.trim().replace("STRIPE_API_KEY=<redacted>", `STRIPE_API_KEY=${TEST_KEY}`);
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

  it("renders a value containing a space as one shell-quoted token", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "customer", "add", "--name", "Jane Doe");
    expect(r.stdout).toContain("-d 'name=Jane Doe'");
    expect(r.stdout).not.toContain(TEST_KEY);
  });

  it("stays parseable when a value contains a newline", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "customer", "add", "--name", "Line one\nLine two");
    expect(r.status).toBe(0);
    expect(r.invocations).toEqual([]);
    expect(parseToon(r.stdout).ok).toBe(true);
  });

  // The printed command is only useful if pasting it reproduces the exact
  // request, so run it for real: shell quoting and TOON escaping must not
  // corrupt each other.
  it.each([
    { label: "a space", name: "Jane Doe" },
    { label: "an apostrophe", name: "O'Hara Ltd" },
    { label: "a comma and a quote", name: 'Doe, "Jane"' },
  ])("prints a command that reconstructs a name with $label", ({ name }) => {
    const dry = run({ STRIPE_API_KEY: TEST_KEY }, "customer", "add", "--name", name);
    expect(dry.status).toBe(0);
    expect(dry.invocations).toEqual([]);
    expect(parseToon(dry.stdout).ok).toBe(true);

    const replay = runShell(dryRunCommand(dry.stdout));
    expect(replay.status).toBe(0);
    expect(replay.invocations).toHaveLength(1);
    expect(replay.invocations[0]).toContain(`-d name=${name}`);
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

// Stripe's own Idempotency-Replayed response header is the only trustworthy
// signal here: comparing Stripe's `created` against the local clock mislabels
// every fresh write on a host whose clock runs fast.
describe("idempotent-replay labelling", () => {
  it("asks the Stripe CLI for response headers on a keyed write", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_123", "--amount", "500", "--confirm");
    expect(r.invocations[0]).toContain("--show-headers");
  });

  it("does not ask for headers on a read", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "balance");
    expect(r.invocations[0]).not.toContain("--show-headers");
  });

  it("labels the result when Stripe reports the request was replayed", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { replayHeader: "true" }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("REPLAY of a prior identical operation (not freshly executed)");
    expect(r.stdout).toContain("refunded: obj_stub_1");
    expect(parseToon(r.stdout).ok).toBe(true);
  });

  it("says nothing about replays when Stripe reports a fresh execution", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { replayHeader: "false" }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("refunded: obj_stub_1");
    expect(r.stdout).not.toContain("REPLAY");
  });

  it("claims nothing when Stripe does not report the header at all", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { replayHeader: "absent" }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("refunded: obj_stub_1");
    expect(r.stdout).not.toContain("REPLAY");
  });

  it("does not depend on the local clock: an old object is not a replay", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { oldCreated: true, replayHeader: "false" }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(0);
    expect(r.stdout).not.toContain("REPLAY");
  });
});

describe("pagination suggestions keep the current view", () => {
  it("carries the active filters and limit into the next-page command", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { listRows: true, hasMore: true }, [
      "charges", "--customer", "cus_123", "--limit", "50",
    ]);
    expect(r.status).toBe(0);
    const suggestion = r.stdout.split("\n").find((l) => l.includes("more results"));
    expect(suggestion).toBeDefined();
    expect(suggestion).toContain("--customer cus_123");
    expect(suggestion).toContain("--limit 50");
    expect(suggestion).toContain("--starting-after ch_stub_1");
  });

  it("does not suggest a next page when there is none", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { listRows: true }, ["charges", "--customer", "cus_123"]);
    expect(r.stdout).not.toContain("more results");
  });
});

describe("large output survives a slow consumer", () => {
  it("delivers the whole document instead of one pipe buffer", () => {
    // process.exit() drops whatever stdout still has queued for the pipe,
    // truncating the TOON document at ~64KB with exit code 0.
    const log = join(sandbox, `invocations-${runCount++}.log`);
    const command = `${JSON.stringify(process.execPath)} ${JSON.stringify(bin)} charges --limit 100 --fields id,amount,description | (sleep 0.4; cat)`;
    const r = spawnSync("/bin/sh", ["-c", command], {
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        HOME: sandbox,
        PATH: stubPath,
        STRIPE_API_KEY: TEST_KEY,
        STRIPE_AXI_STUB_LOG: log,
        STRIPE_AXI_STUB_BIG_LIST: "1",
      },
    });
    expect(r.status).toBe(0);
    expect(r.stdout.length).toBeGreaterThan(200_000);
    expect(r.stdout).toContain("ch_big_99");
    expect(r.stdout.trimEnd().endsWith("stripe-axi refund <charge-id> --amount <cents>")).toBe(true);
    expect(parseToon(r.stdout).ok).toBe(true);
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

describe("mode is surfaced on every invocation", () => {
  const KEYS = [
    { label: "TEST", key: TEST_KEY },
    { label: "LIVE", key: LIVE_KEY },
  ];

  it.each(KEYS)("shows mode $label above a list that has results", ({ label, key }) => {
    const r = runWith({ STRIPE_API_KEY: key }, { listRows: true }, ["charges"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`mode: ${label}`);
    expect(r.stdout).toContain("charges[1]{");
  });

  it.each(KEYS)("shows mode $label on an empty list", ({ label, key }) => {
    const r = run({ STRIPE_API_KEY: key }, "charges");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`mode: ${label}`);
    expect(r.stdout).toContain("charges: 0 results");
  });

  it.each(KEYS)("shows mode $label on a detail command", ({ label, key }) => {
    const r = run({ STRIPE_API_KEY: key }, "charge", "ch_123");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(`mode: ${label}`);
  });
});

describe("resource IDs are validated before they reach an API path", () => {
  const MALICIOUS = "cus_1/../../v1/subscriptions/sub_9";

  it("refuses a path-traversing ID on a gated write without invoking stripe", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "customer", "rm", MALICIOUS, "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error: invalid id");
    expect(r.invocations).toEqual([]);
  });

  it("refuses a path-traversing ID on a read command without invoking stripe", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "charge", MALICIOUS);
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error: invalid id");
    expect(r.invocations).toEqual([]);
  });

  it("refuses a query-string ID on the refund command without invoking stripe", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_1?expand=foo", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error: invalid id");
    expect(r.invocations).toEqual([]);
  });

  it("still accepts a normal Stripe ID", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "charge", "ch_3Nk1ABc-de.f");
    expect(r.status).toBe(0);
    expect(r.invocations).toEqual(["get /v1/charges/ch_3Nk1ABc-de.f --color off"]);
  });
});

describe("the Stripe CLI is missing", () => {
  it("reports the install hint instead of crashing", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { path: emptyDir }, ["balance"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("is not installed or not on PATH");
    expect(r.stdout).toContain("brew install stripe/stripe-cli/stripe");
  });

  it("still shows the mode and the command inventory on the home view", () => {
    const r = runWith({ STRIPE_API_KEY: LIVE_KEY }, { path: emptyDir }, []);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("the official Stripe CLI is not installed");
    expect(r.stdout).toContain("brew install stripe/stripe-cli/stripe");
    expect(r.stdout).toContain("mode: LIVE");
    expect(r.stdout).toMatch(/^commands\[\d+\]\{/m);
    expect(r.stdout).not.toContain(LIVE_KEY);
    expect(parseToon(r.stdout).ok).toBe(true);
  });
});

describe("money amounts are validated and canonicalised", () => {
  it("refuses an amount that is not a whole number", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_1", "--amount", "5.00", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("invalid --amount");
    expect(r.invocations).toEqual([]);
  });

  it("refuses a zero or negative amount", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "payout", "create", "--amount", "0", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("invalid --amount");
    expect(r.invocations).toEqual([]);
  });

  it("derives one Idempotency-Key regardless of currency case or amount padding", () => {
    const canonical = run({ STRIPE_API_KEY: TEST_KEY }, "payout", "create", "--amount", "10000", "--currency", "usd");
    const noisy = run({ STRIPE_API_KEY: TEST_KEY }, "payout", "create", "--amount", "010000", "--currency", "USD");
    const key = (stdout: string) => /-i (\S+)/.exec(stdout)?.[1];
    expect(key(canonical.stdout)).toBeDefined();
    expect(key(noisy.stdout)).toBe(key(canonical.stdout));
  });
});

describe("surplus positional arguments are refused", () => {
  it("refuses an extra argument on a gated write instead of silently dropping it", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "charge", "capture", "ch_1", "500", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("unexpected argument '500'");
    expect(r.invocations).toEqual([]);
  });

  it("refuses a second ID on refund", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "refund", "ch_1", "ch_2", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("unexpected argument 'ch_2'");
    expect(r.invocations).toEqual([]);
  });

  it("refuses a stray argument on a read command", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "charges", "cus_123");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("unexpected argument 'cus_123'");
    expect(r.stdout).toContain("--customer");
    expect(r.invocations).toEqual([]);
  });

  it("still accepts the documented argument count", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "charge", "capture", "ch_1");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("dry-run:");
  });
});

describe("a failing Stripe CLI keeps the stdout contract", () => {
  it("renders a multi-line CLI error as parseable TOON", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { fail: true }, ["balance"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("error:");
    expect(r.stdout).toContain("unknown flag: --nope");
    expect(parseToon(r.stdout).ok).toBe(true);
  });

  // Writes run with --show-headers, so the CLI's request/response trace
  // reaches stderr before the message the user needs.
  it("shows the Stripe error on a failed write, not the header trace", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { fail: true }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("Invalid API Key provided");
    expect(r.stdout).not.toContain("Authorization:");
    expect(r.stdout).not.toContain("Idempotency-Key:");
    expect(parseToon(r.stdout).ok).toBe(true);
  });
});

describe("a write that fails with only a trace still says why", () => {
  it("surfaces the HTTP status instead of a bare exit code", () => {
    const r = runWith({ STRIPE_API_KEY: TEST_KEY }, { failTraceOnly: true }, ["refund", "ch_123", "--amount", "500", "--confirm"]);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain("HTTP 401");
    expect(r.stdout).not.toContain("re-run with the same arguments");
    expect(r.stdout).not.toContain("Authorization:");
    expect(parseToon(r.stdout).ok).toBe(true);
  });
});

describe("subscription cancel flag combinations", () => {
  it("refuses immediate-cancel-only flags alongside --at-period-end", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "subscription", "cancel", "sub_1", "--at-period-end", "--invoice-now", "--prorate", "--confirm");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("--at-period-end cannot be combined with --invoice-now or --prorate");
    expect(r.invocations).toEqual([]);
  });

  it("still sends those flags on an immediate cancel", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "subscription", "cancel", "sub_1", "--invoice-now", "--prorate", "--confirm");
    expect(r.status).toBe(0);
    expect(r.invocations[0]).toContain("-d invoice_now=true");
    expect(r.invocations[0]).toContain("-d prorate=true");
  });

  it("still schedules a plain period-end cancel", () => {
    const r = run({ STRIPE_API_KEY: TEST_KEY }, "subscription", "cancel", "sub_1", "--at-period-end", "--confirm");
    expect(r.status).toBe(0);
    expect(r.invocations[0]).toContain("-d cancel_at_period_end=true");
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
