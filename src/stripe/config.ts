// API key discovery and live/test mode detection. Never logs or echoes the
// key itself - only the safe prefix (e.g. "sk_test_") is ever surfaced.

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { AxiError } from "../output/errors.js";

export type KeyMode = "test" | "live";
export type KeyKind = "secret" | "restricted";

export interface KeyInfo {
  key: string;
  mode: KeyMode;
  kind: KeyKind;
  /** Safe-to-display prefix, e.g. "sk_test_". Never the full key. */
  prefix: string;
}

export const CONFIG_PATH = join(homedir(), ".config", "stripe-axi", "credentials");

const PREFIXES: Array<{ prefix: string; mode: KeyMode; kind: KeyKind }> = [
  { prefix: "sk_test_", mode: "test", kind: "secret" },
  { prefix: "sk_live_", mode: "live", kind: "secret" },
  { prefix: "rk_test_", mode: "test", kind: "restricted" },
  { prefix: "rk_live_", mode: "live", kind: "restricted" },
];

export function parseKey(raw: string): KeyInfo {
  const key = raw.trim();
  const match = PREFIXES.find((p) => key.startsWith(p.prefix));
  if (!match) {
    throw new AxiError(
      "unrecognized Stripe API key format",
      "expected a key starting with sk_test_, sk_live_, rk_test_, or rk_live_ - create one at https://dashboard.stripe.com/apikeys",
    );
  }
  if (key.length < match.prefix.length + 8) {
    throw new AxiError(
      "Stripe API key looks truncated",
      "re-copy the full key from https://dashboard.stripe.com/apikeys",
    );
  }
  return { key, mode: match.mode, kind: match.kind, prefix: match.prefix };
}

/** Reads STRIPE_API_KEY=... (or a bare key) from the credentials file. */
function readCredentialsFile(): string | undefined {
  if (!existsSync(CONFIG_PATH)) return undefined;
  const content = readFileSync(CONFIG_PATH, "utf8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) return trimmed;
    const name = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, "");
    if (name === "STRIPE_API_KEY") return value;
  }
  return undefined;
}

export interface LoadResult {
  info: KeyInfo | null;
  source: "env" | "config" | "none";
}

/** Precedence: STRIPE_API_KEY env var, then ~/.config/stripe-axi/credentials. */
export function loadKey(): LoadResult {
  const fromEnv = process.env.STRIPE_API_KEY;
  if (fromEnv && fromEnv.trim()) {
    return { info: parseKey(fromEnv), source: "env" };
  }
  const fromFile = readCredentialsFile();
  if (fromFile && fromFile.trim()) {
    return { info: parseKey(fromFile), source: "config" };
  }
  return { info: null, source: "none" };
}

export function requireKey(): KeyInfo {
  const { info } = loadKey();
  if (!info) {
    throw new AxiError(
      "no Stripe API key found",
      `set STRIPE_API_KEY in your environment, or write one to ${collapseHome(CONFIG_PATH)} - start with a TEST key (sk_test_...) from https://dashboard.stripe.com/apikeys`,
    );
  }
  return info;
}

export function collapseHome(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}
