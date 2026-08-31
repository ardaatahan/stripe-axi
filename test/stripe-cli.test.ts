// Unit tests for the Stripe CLI wrapper: argument construction (form
// encoding, idempotency key placement) and response/error mapping. Process
// execution is swapped out via dependency injection (see SpawnFn in
// src/stripe/cli.ts) rather than mocking node:child_process — built-in
// module mocks are unreliable across ESM test-runner setups and, when they
// silently fail to intercept, tests hang for a full 60s timeout waiting on
// a real `stripe` process that was never actually replaced.

import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";
import { FIXTURE_CHARGE, FIXTURE_ERROR_INVALID_REQUEST } from "./fixtures.js";
import { buildCliArgs, flattenParams, renderCliCommand, stripeCliRequest, STRIPE_CLI_INSTALL_HINT } from "../src/stripe/cli.js";
import { AxiError } from "../src/output/errors.js";

function fakeSpawn(opts: { stdout?: string; stderr?: string; code?: number | null; spawnError?: NodeJS.ErrnoException }) {
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

  it("always passes --color off and --confirm to the underlying stripe process", () => {
    const args = buildCliArgs({ method: "GET", path: "/v1/balance" });
    expect(args).toEqual(["get", "/v1/balance", "--color", "off", "--confirm"]);
  });

  it("omits undefined/null params entirely", () => {
    expect(flattenParams({ a: "x", b: undefined, c: null })).toEqual(["a=x"]);
  });
});

describe("renderCliCommand", () => {
  it("never includes the real API key", () => {
    const rendered = renderCliCommand({ method: "POST", path: "/v1/refunds", params: { charge: "ch_1" } });
    expect(rendered).not.toContain("sk_test_");
    expect(rendered).toContain("<redacted>");
    expect(rendered).toContain("stripe post /v1/refunds");
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

  it("surfaces non-JSON stdout as a clear error instead of crashing", async () => {
    const { spawnFn } = fakeSpawn({ stdout: "not json", stderr: "some warning", code: 1 });
    await expect(
      stripeCliRequest({ method: "GET", path: "/v1/balance", apiKey: "sk_test_x" }, spawnFn),
    ).rejects.toThrow(/non-JSON response/);
  });

  it("passes the API key via argv, not a shell string (no shell:true)", async () => {
    const { spawnFn, calls } = fakeSpawn({ stdout: JSON.stringify(FIXTURE_CHARGE), code: 0 });
    await stripeCliRequest({ method: "GET", path: "/v1/charges/ch_1", apiKey: "sk_test_SECRET" }, spawnFn);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.command).toBe("stripe");
    expect(calls[0]!.args).toContain("sk_test_SECRET");
    expect((calls[0]!.options as { shell?: boolean })?.shell).not.toBe(true);
  });
});
