// Wraps the official Stripe CLI (`stripe`) via child_process — stripe-axi
// never talks to api.stripe.com directly. Every API call becomes
// `stripe get|post|delete <path> [-d k=v...] [-i <idempotency-key>]`, the
// documented full-coverage passthrough (docs.stripe.com/cli/get, /cli/post,
// /cli/delete) rather than the resource subcommands (`stripe customers ...`),
// whose per-resource operation names aren't fully enumerable from docs alone
// — using one fully-verified code path for every resource keeps this
// correct and testable instead of guessing at ~15 resources' verb sets.
//
// `--confirm` is passed to the underlying `stripe` process on every call so
// its own interactive "are you sure?" prompt never blocks a non-interactive
// run — that is a DIFFERENT flag from stripe-axi's own `--confirm` (see
// src/safety/gate.ts), which is what decided to invoke the CLI at all.

import { spawn as nodeSpawn } from "node:child_process";
import { AxiError } from "../output/errors.js";
import { stripeErrorToAxiError, type StripeErrorBody } from "./errors.js";

/**
 * The process-spawning function, injectable so tests can substitute a fake
 * `stripe` process without mocking node:child_process itself (built-in
 * module mocks are unreliable across bundler/test-runner ESM setups).
 */
export type SpawnFn = typeof nodeSpawn;

export const STRIPE_CLI_BIN = "stripe";
export const STRIPE_CLI_INSTALL_HINT =
  "install the official Stripe CLI: 'brew install stripe/stripe-cli/stripe' (Homebrew) or 'npm install -g @stripe/cli' — see https://docs.stripe.com/stripe-cli for other platforms";

export type CliMethod = "GET" | "POST" | "DELETE";

export interface CliRequest {
  method: CliMethod;
  /** Full API path, e.g. "/v1/charges/ch_123". */
  path: string;
  params?: Record<string, unknown>;
  /** Only meaningful (and only sent) for POST. */
  idempotencyKey?: string;
  apiKey: string;
}

/** Flattens nested params into Stripe's bracket form-encoding as -d args. */
export function flattenParams(params: Record<string, unknown>, prefix = ""): string[] {
  const out: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    const key = prefix ? `${prefix}[${k}]` : k;
    if (Array.isArray(v)) {
      v.forEach((item, i) => out.push(...flattenParams({ [i]: item }, key)));
    } else if (typeof v === "object") {
      out.push(...flattenParams(v as Record<string, unknown>, key));
    } else {
      out.push(`${key}=${String(v)}`);
    }
  }
  return out;
}

export function buildCliArgs(req: Omit<CliRequest, "apiKey">): string[] {
  const verb = req.method === "GET" ? "get" : req.method === "POST" ? "post" : "delete";
  const args = [verb, req.path, "--color", "off", "--confirm"];
  for (const p of flattenParams(req.params ?? {})) args.push("-d", p);
  if (req.method === "POST" && req.idempotencyKey) args.push("-i", req.idempotencyKey);
  return args;
}

/** Renders the equivalent shell command for dry-run display — the API key is never included. */
export function renderCliCommand(req: Omit<CliRequest, "apiKey">): string {
  return ["stripe", ...buildCliArgs(req), "--api-key", "<redacted>"].join(" ");
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/** Isolated so tests can inject a fake spawn function without a real `stripe` binary. */
export function execStripeCli(args: string[], spawnFn: SpawnFn = nodeSpawn): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(STRIPE_CLI_BIN, args, { stdio: ["ignore", "pipe", "pipe"] });
    } catch (err) {
      reject(mapSpawnError(err));
      return;
    }
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    child.on("error", (err) => reject(mapSpawnError(err)));
    child.on("close", (code) => resolve({ stdout, stderr, code }));
  });
}

function mapSpawnError(err: unknown): AxiError {
  const code = (err as NodeJS.ErrnoException)?.code;
  if (code === "ENOENT") {
    return new AxiError("the official Stripe CLI ('stripe') is not installed or not on PATH", STRIPE_CLI_INSTALL_HINT);
  }
  const message = err instanceof Error ? err.message : String(err);
  return new AxiError(`failed to run the Stripe CLI: ${message}`, STRIPE_CLI_INSTALL_HINT);
}

export async function stripeCliRequest(req: CliRequest, spawnFn?: SpawnFn): Promise<any> {
  const args = [...buildCliArgs(req), "--api-key", req.apiKey];
  const result = await execStripeCli(args, spawnFn);
  const text = result.stdout.trim();

  let json: any;
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    const detail = (result.stderr || text).trim().slice(0, 500);
    throw new AxiError(
      `the Stripe CLI returned a non-JSON response (exit ${result.code})`,
      detail ? `stripe CLI said: ${detail}` : "run 'stripe --version' to confirm the CLI is installed and working",
    );
  }

  if (json && typeof json === "object" && json.error) {
    throw stripeErrorToAxiError(json as StripeErrorBody);
  }
  if (result.code !== 0) {
    const detail = (result.stderr || text).trim().slice(0, 500);
    throw new AxiError(
      `the Stripe CLI exited with code ${result.code}`,
      detail || "re-run with the same arguments; report if it persists",
    );
  }
  return json;
}

/** Cheap presence check for the home view — does not require a valid key. */
export async function isStripeCliInstalled(spawnFn?: SpawnFn): Promise<boolean> {
  try {
    const result = await execStripeCli(["--version"], spawnFn);
    return result.code === 0;
  } catch {
    return false;
  }
}
