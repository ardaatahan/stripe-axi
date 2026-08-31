// Smoke tests for the AXI contract. Requires a build first (`pretest`
// runs it automatically via `npm test`).

import { spawnSync } from "node:child_process";
import { copyFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, describe, expect, it } from "vitest";

const bin = fileURLToPath(new URL("../bin/stripe-axi.js", import.meta.url));

// These assert the AXI contract, not Stripe behaviour, so the binary must see
// no key: an exported STRIPE_API_KEY (or a real ~/.config/stripe-axi/credentials)
// would otherwise send a developer's own account data through these runs.
const noKeyHome = mkdtempSync(join(tmpdir(), "stripe-axi-cli-"));
afterAll(() => rmSync(noKeyHome, { recursive: true, force: true }));

function run(...args: string[]) {
  const env = { ...process.env, HOME: noKeyHome };
  delete env.STRIPE_API_KEY;
  return spawnSync(process.execPath, [bin, ...args], { encoding: "utf8", env });
}

describe("stripe-axi AXI contract", () => {
  it("no-args shows content and exits 0 (principle 8)", () => {
    const r = run();
    expect(r.status).toBe(0);
    expect(r.stdout).not.toMatch(/^\s*usage[:\s]/i);
    expect(r.stdout.trim().length).toBeGreaterThan(0);
  });

  it("--help exits 0 and lists flags (principle 10)", () => {
    const r = run("--help");
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("--");
  });

  it("unknown flag exits 2 naming valid flags (principle 6)", () => {
    const r = run("--not-a-real-flag");
    expect(r.status).toBe(2);
    expect(r.stdout).toContain("error:");
    expect(r.stdout).toContain("--");
  });

  it("stderr is silent on success (principle 6)", () => {
    const r = run();
    expect(r.stderr.trim()).toBe("");
  });
});

describe("--version", () => {
  it("reports the version from the package manifest", () => {
    // package.json is the published manifest, and the version the CLI reports
    // must be the version that was installed.
    const manifest = JSON.parse(
      readFileSync(fileURLToPath(new URL("../package.json", import.meta.url)), "utf8"),
    );
    const r = run("--version");
    expect(r.status).toBe(0);
    expect(r.stdout.trim()).toBe(`stripe-axi: ${manifest.version}`);
  });
});

describe("an unbuilt checkout", () => {
  it("reports the missing build as a structured error instead of a stack trace", () => {
    // The launcher resolves dist/ relative to itself, so a copy outside the
    // repo is exactly the state of a checkout that was never built.
    const unbuilt = mkdtempSync(join(tmpdir(), "stripe-axi-unbuilt-"));
    try {
      const launcher = join(unbuilt, "stripe-axi.js");
      copyFileSync(bin, launcher);
      const r = spawnSync(process.execPath, [launcher, "balance"], { encoding: "utf8" });
      expect(r.status).toBe(1);
      expect(r.stdout).toContain("error: stripe-axi is not built");
      expect(r.stdout).toContain("suggestion: run 'npm run build'");
      expect(r.stderr).not.toContain("ERR_MODULE_NOT_FOUND");
    } finally {
      rmSync(unbuilt, { recursive: true, force: true });
    }
  });
});
