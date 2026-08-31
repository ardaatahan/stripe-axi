import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  const ORIGINAL_HOME = process.env.HOME;
  let home: string;

  // HOME is redirected to an empty temp dir so a developer's real
  // ~/.config/stripe-axi/credentials cannot decide the outcome, and the module
  // is reloaded because CONFIG_PATH is resolved once at import time.
  beforeEach(() => {
    delete process.env.STRIPE_API_KEY;
    home = mkdtempSync(join(tmpdir(), "stripe-axi-home-"));
    process.env.HOME = home;
    vi.resetModules();
  });

  afterEach(() => {
    if (ORIGINAL_ENV === undefined) delete process.env.STRIPE_API_KEY;
    else process.env.STRIPE_API_KEY = ORIGINAL_ENV;
    if (ORIGINAL_HOME === undefined) delete process.env.HOME;
    else process.env.HOME = ORIGINAL_HOME;
    rmSync(home, { recursive: true, force: true });
  });

  async function writeCredentials(contents: string) {
    const { CONFIG_PATH } = await import("../src/stripe/config.js");
    mkdirSync(dirname(CONFIG_PATH), { recursive: true });
    writeFileSync(CONFIG_PATH, contents);
    expect(CONFIG_PATH.startsWith(home)).toBe(true);
  }

  it("prefers STRIPE_API_KEY over the config file when both are set", async () => {
    await writeCredentials("STRIPE_API_KEY=sk_test_filekey12345678\n");
    process.env.STRIPE_API_KEY = "sk_test_envkey123456789";
    const { loadKey } = await import("../src/stripe/config.js");
    const { info, source } = loadKey();
    expect(source).toBe("env");
    expect(info?.key).toBe("sk_test_envkey123456789");
  });

  it("falls back to the credentials file when the env var is unset", async () => {
    await writeCredentials("STRIPE_API_KEY=sk_test_filekey12345678\n");
    const { loadKey } = await import("../src/stripe/config.js");
    const { info, source } = loadKey();
    expect(source).toBe("config");
    expect(info?.key).toBe("sk_test_filekey12345678");
  });

  it("reports no key found when neither source is set", async () => {
    const { loadKey } = await import("../src/stripe/config.js");
    const { info, source } = loadKey();
    expect(info).toBeNull();
    expect(source).toBe("none");
  });
});
