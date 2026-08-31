// Unit tests for the Stripe CLI wrapper: argument construction (form
// encoding, idempotency key placement) and response/error mapping. Process
// execution is swapped out via dependency injection (see SpawnFn in
// src/stripe/cli.ts) rather than mocking node:child_process - built-in
// module mocks are unreliable across ESM test-runner setups and, when they
// silently fail to intercept, tests hang for a full 60s timeout waiting on
// a real `stripe` process that was never actually replaced.

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { FIXTURE_CHARGE, FIXTURE_ERROR_INVALID_REQUEST } from "./fixtures.js";
import { buildCliArgs, cliErrorDetail, flattenParams, parseIdempotentReplayed, renderCliCommand, stripeCliCall, stripeCliRequest, STRIPE_CLI_INSTALL_HINT } from "../src/stripe/cli.js";
import { AxiError } from "../src/output/errors.js";

function fakeSpawn(opts: {
  stdout?: string;
  /** Raw stdout chunks, for exercising chunk-boundary decoding. */
  chunks?: Buffer[];
  stderr?: string;
  code?: number | null;
  spawnError?: NodeJS.ErrnoException;
}) {
  const calls: Array<{ command: string; args: string[]; options: unknown }> = [];
  const spawnFn = (command: string, args: string[], options: unknown) => {
    calls.push({ command, args, options });
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      if (opts.spawnError) {
        child.emit("error", opts.spawnError);
        return;
      }
      if (opts.stdout) child.stdout.emit("data", Buffer.from(opts.stdout));
      for (const chunk of opts.chunks ?? []) child.stdout.emit("data", chunk);
      if (opts.stderr) child.stderr.emit("data", Buffer.from(opts.stderr));
      child.emit("close", opts.code ?? 0);
    });
    return child;
  };
  return { spawnFn: spawnFn as any, calls };
}

describe("buildCliArgs / flattenParams", () => {
  it("flattens nested params into Stripe bracket form-encoding", () => {
    const args = buildCliArgs({
      method: "POST",
      path: "/v1/checkout/sessions",
      params: { mode: "payment", line_items: [{ price: "price_123", quantity: 2 }] },
    });
    expect(args).toContain("-d");
    expect(args.join(" ")).toContain("line_items[0][price]=price_123");
    expect(args.join(" ")).toContain("line_items[0][quantity]=2");
    expect(args.join(" ")).toContain("mode=payment");
  });

  it("puts the idempotency key on POST only", () => {
    const post = buildCliArgs({ method: "POST", path: "/v1/refunds", params: {}, idempotencyKey: "key123" });
    const del = buildCliArgs({ method: "DELETE", path: "/v1/customers/cus_1", idempotencyKey: "key123" });
    expect(post).toContain("-i");
    expect(post).toContain("key123");
    expect(del).not.toContain("-i");
  });

  it("passes --confirm to the underlying stripe process on mutating calls only", () => {
    // Only DELETE prompts for confirmation, so a read never needs the flag.
    expect(buildCliArgs({ method: "GET", path: "/v1/balance" })).toEqual(["get", "/v1/balance", "--color", "off"]);
    expect(buildCliArgs({ method: "POST", path: "/v1/refunds" })).toEqual([
      "post", "/v1/refunds", "--color", "off", "--confirm",
    ]);
    expect(buildCliArgs({ method: "DELETE", path: "/v1/customers/cus_1" })).toEqual([
      "delete", "/v1/customers/cus_1", "--color", "off", "--confirm",
    ]);
  });

  it("asks for response headers only when requested", () => {
    expect(buildCliArgs({ method: "POST", path: "/v1/refunds" })).not.toContain("--show-headers");
    expect(buildCliArgs({ method: "POST", path: "/v1/refunds", showHeaders: true })).toContain("--show-headers");
  });

  it("omits undefined/null params entirely", () => {
    expect(flattenParams({ a: "x", b: undefined, c: null })).toEqual(["a=x"]);
  });
});

describe("cliErrorDetail", () => {
  // A --show-headers run prints the whole request/response trace to stderr
  // before the real error, and it is long enough to fill the detail budget on
  // its own.
  const VERBOSE_FAILURE = [
    "> POST https://api.stripe.com/v1/refunds",
    "> Authorization: Bearer [REDACTED]",
    "> Content-Type: application/x-www-form-urlencoded",
    "> Idempotency-Key: stripe-axi_refund.create_47942a952b6c7cf2f89310eb5f86299b642d9e52",
    "> Stripe-Version: 2024-06-20",
    "< HTTP 401",
    "< Date: Mon, 31 Aug 2026 12:00:00 GMT",
    "< Request-Id: req_abc123",
    "< Content-Type: application/json",
    "Error: Invalid API Key provided: sk_test_***********************XYZ",
  ].join("\n");

  it("surfaces the real error instead of the header trace", () => {
    expect(cliErrorDetail(VERBOSE_FAILURE)).toBe(
      "Error: Invalid API Key provided: sk_test_***********************XYZ",
    );
  });

  it("keeps the lines that follow the error", () => {
    const detail = cliErrorDetail("Error: unknown flag: --nope\nUsage:\n  stripe post <path> [flags]");
    expect(detail).toContain("unknown flag: --nope");
    expect(detail).toContain("stripe post <path> [flags]");
  });

  it("keeps plain stderr that has no trace and no Error: line", () => {
    expect(cliErrorDetail("something went wrong")).toBe("something went wrong");
  });

  it("reports nothing when stderr is only a header trace", () => {
    expect(cliErrorDetail("> POST https://api.stripe.com/v1/refunds\n< HTTP 500\n")).toBe("");
  });

  it("stays within the detail budget", () => {
    expect(cliErrorDetail(`Error: ${"x".repeat(900)}`).length).toBe(500);
  });
});

describe("parseIdempotentReplayed", () => {
  // `stripe --show-headers` prints response headers to stderr, one per line,
  // prefixed with "< " (stripe-cli pkg/stripe/verbosetransport.go).
  const HEADERS = [
    "> POST /v1/refunds",
    "> Idempotency-Key: stripe-axi_refund.create_abc",
    "< Request-Id: req_123",
    "< Stripe-Version: 2024-06-20",
  ];

  it("reads a replayed response", () => {
    expect(parseIdempotentReplayed([...HEADERS, "< Idempotency-Replayed: true"].join("\n"))).toBe(true);
  });

  it("reads a freshly executed response", () => {
    expect(parseIdempotentReplayed([...HEADERS, "< Idempotency-Replayed: false"].join("\n"))).toBe(false);
  });

  it("reports nothing when the header is absent", () => {
    expect(parseIdempotentReplayed(HEADERS.join("\n"))).toBeUndefined();
  });

  it("reports nothing rather than guessing when the value is unparseable", () => {
    expect(parseIdempotentReplayed("< Idempotency-Replayed: maybe")).toBeUndefined();
  });

  it("reports nothing for empty stderr", () => {
    expect(parseIdempotentReplayed("")).toBeUndefined();
  });
});

describe("stripeCliCall", () => {
  it("surfaces the replay verdict alongside the parsed body", async () => {
    const { spawnFn } = fakeSpawn({
      stdout: JSON.stringify(FIXTURE_CHARGE),
      stderr: "< Idempotency-Replayed: true\n",
      code: 0,
    });
    const response = await stripeCliCall(
      { method: "POST", path: "/v1/refunds", idempotencyKey: "k", showHeaders: true, apiKey: "sk_test_x" },
      spawnFn,
    );
    expect(response.json.id).toBe(FIXTURE_CHARGE.id);
    expect(response.idempotentReplayed).toBe(true);
  });
});

describe("renderCliCommand", () => {
  it("never includes the real API key", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/refunds", params: { charge: "ch_1" } });
    expect(rendered).not.toContain("sk_test_");
    expect(rendered).toContain("<redacted>");
    expect(rendered).toContain("STRIPE_API_KEY=<redacted> stripe post /v1/refunds");
  });

  it("shell-quotes values so the printed command runs as one token", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/customers", params: { name: "Jane Doe" } });
    expect(rendered).toContain("-d 'name=Jane Doe'");
  });

  it("escapes a value containing a single quote", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/customers", params: { name: "O'Hara Ltd" } });
    expect(rendered).toContain("-d 'name=O'\\''Hara Ltd'");
  });

  it("keeps a value containing a newline on one line", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/customers", params: { description: "one\ntwo" } });
    expect(rendered.split("\n")).toHaveLength(1);
    expect(rendered).toContain("-d $'description=one\\ntwo'");
  });

  it("leaves ordinary tokens unquoted", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/refunds", params: { charge: "ch_1" } });
    expect(rendered).toContain("-d charge=ch_1");
  });
});

describe("stripeCliRequest", () => {
  it("parses a successful JSON response", async () => {
    const { spawnFn } = fakeSpawn({ stdout: JSON.stringify(FIXTURE_CHARGE), code: 0 });
    const result = await stripeCliRequest({ method: "GET", path: "/v1/charges/ch_1", apiKey: "sk_test_x" }, spawnFn);
    expect(result.id).toBe(FIXTURE_CHARGE.id);
  });

  it("maps a Stripe error body to a structured AxiError", async () => {
    const { spawnFn } = fakeSpawn({ stdout: JSON.stringify(FIXTURE_ERROR_INVALID_REQUEST), code: 1 });
    await expect(
      stripeCliRequest({ method: "GET", path: "/v1/charges/ch_bad", apiKey: "sk_test_x" }, spawnFn),
    ).rejects.toThrow(/resource_missing/);
  });

  it("maps ENOENT (stripe not installed) to a clear install hint", async () => {
    const enoent = Object.assign(new Error("spawn stripe ENOENT"), { code: "ENOENT" });
    const { spawnFn } = fakeSpawn({ spawnError: enoent as NodeJS.ErrnoException });
    try {
      await stripeCliRequest({ method: "GET", path: "/v1/balance", apiKey: "sk_test_x" }, spawnFn);
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AxiError);
      expect((err as InstanceType<typeof AxiError>).message).toMatch(/not installed/);
      expect((err as InstanceType<typeof AxiError>).suggestion).toBe(STRIPE_CLI_INSTALL_HINT);
    }
  });

  it("suggests the Stripe error, not the verbose header dump, on a failed write", async () => {
    const stderr = [
      "> POST https://api.stripe.com/v1/refunds",
      "> Authorization: Bearer [REDACTED]",
      "> Idempotency-Key: stripe-axi_refund.create_47942a952b6c7cf2f89310eb5f86299b642d9e52",
      "< HTTP 401",
      "< Request-Id: req_abc123",
      "Error: Invalid API Key provided: sk_test_***********************XYZ",
    ].join("\n");
    const { spawnFn } = fakeSpawn({ stdout: "", stderr, code: 1 });
    try {
      await stripeCliCall(
        { method: "POST", path: "/v1/refunds", idempotencyKey: "k", showHeaders: true, apiKey: "sk_test_x" },
        spawnFn,
      );
      expect.unreachable();
    } catch (err) {
      const axiErr = err as InstanceType<typeof AxiError>;
      expect(axiErr.suggestion).toContain("Invalid API Key provided");
      expect(axiErr.suggestion).not.toContain("Idempotency-Key:");
      expect(axiErr.suggestion).not.toContain("Authorization:");
    }
  });

  it("surfaces non-JSON stdout as a clear error instead of crashing", async () => {
    const { spawnFn } = fakeSpawn({ stdout: "not json", stderr: "some warning", code: 1 });
    await expect(
      stripeCliRequest({ method: "GET", path: "/v1/balance", apiKey: "sk_test_x" }, spawnFn),
    ).rejects.toThrow(/non-JSON response/);
  });

  it("passes the API key in the child's environment, never in argv", async () => {
    // argv is readable from the process table by other local users, so a live
    // key must not appear there.
    const { spawnFn, calls } = fakeSpawn({ stdout: JSON.stringify(FIXTURE_CHARGE), code: 0 });
    await stripeCliRequest({ method: "GET", path: "/v1/charges/ch_1", apiKey: "sk_test_SECRET" }, spawnFn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("stripe");
    expect(calls[0]!.args.join(" ")).not.toContain("sk_test_SECRET");
    const options = calls[0]!.options as { shell?: boolean; env?: Record<string, string> };
    expect(options.env?.STRIPE_API_KEY).toBe("sk_test_SECRET");
    expect(options.shell).not.toBe(true);
  });

  it("decodes a multi-byte character split across two output chunks", async () => {
    // Node hands stdout over in ~64KB chunks that can cut a UTF-8 sequence in
    // half; decoding each chunk on its own turns the halves into replacement
    // characters and breaks JSON.parse on an otherwise valid response.
    const payload = Buffer.from(JSON.stringify({ id: "cus_1", name: "Ana Ñuñez 日本" }), "utf8");
    const cut = payload.indexOf(Buffer.from("日", "utf8")) + 1;
    const { spawnFn } = fakeSpawn({ chunks: [payload.subarray(0, cut), payload.subarray(cut)], code: 0 });
    const result = await stripeCliRequest({ method: "GET", path: "/v1/customers/cus_1", apiKey: "sk_test_x" }, spawnFn);
    expect(result.name).toBe("Ana Ñuñez 日本");
  });
});
