import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parseKey } from "../src/stripe/config.js";
import { AxiError } from "../src/output/errors.js";

describe("parseKey", () => {
  it("detects TEST mode from sk_test_", () => {
    const info = parseKey("sk_test_abcdefgh12345678");
    expect(info.mode).toBe("test");
    expect(info.kind).toBe("secret");
    expect(info.prefix).toBe("sk_test_");
  });

  it("detects LIVE mode from sk_live_", () => {
    const info = parseKey("sk_live_abcdefgh12345678");
    expect(info.mode).toBe("live");
    expect(info.kind).toBe("secret");
  });

  it("detects restricted test keys", () => {
    const info = parseKey("rk_test_abcdefgh12345678");
    expect(info.mode).toBe("test");
    expect(info.kind).toBe("restricted");
  });

  it("detects restricted live keys", () => {
    const info = parseKey("rk_live_abcdefgh12345678");
    expect(info.mode).toBe("live");
    expect(info.kind).toBe("restricted");
  });

  it("rejects an unrecognized key format without echoing it", () => {
    try {
      parseKey("not_a_stripe_key");
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(AxiError);
      const axiErr = err as InstanceType<typeof AxiError>;
      expect(axiErr.message).not.toContain("not_a_stripe_key");
      expect(axiErr.suggestion).toContain("sk_test_");
    }
  });

  it("rejects a truncated key", () => {
    expect(() => parseKey("sk_test_")).toThrow(AxiError);
  });

  it("trims whitespace", () => {
    const info = parseKey("  sk_test_abcdefgh12345678  \n");
    expect(info.key).toBe("sk_test_abcdefgh12345678");
  });
});

describe("loadKey precedence", () => {
  const ORIGINAL_ENV = process.env.STRIPE_API_KEY;

  beforeEach(() => {
    delete process.env.STRIPE_API_KEY;
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = ORIGINAL_ENV;
  });

  it("prefers STRIPE_API_KEY over the config file when both could apply", async () => {
    process.env.STRIPE_API_KEY = "sk_test_envkey123456789";
    const { loadKey } = await import("../src/stripe/config.js");
    const { info, source } = loadKey();
    expect(source).toBe("env");
    expect(info?.key).toBe("sk_test_envkey123456789");
  });

  it("reports no key found when neither source is set", async () => {
    const { loadKey, CONFIG_PATH } = await import("../src/stripe/config.js");
    const { existsSync } = await import("node:fs");
    if (existsSync(CONFIG_PATH)) return; // don't assert away a real local config file
    const { info, source } = loadKey();
    expect(info).toBeNull();
    expect(source).toBe("none");
  });
});
