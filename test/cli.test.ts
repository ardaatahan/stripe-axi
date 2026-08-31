// Smoke tests for the AXI contract. Requires a build first (`pretest`
// runs it automatically via `npm test`).

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
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
