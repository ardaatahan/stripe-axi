// Wraps the official Stripe CLI (`stripe`) via child_process — stripe-axi
// never talks to api.stripe.com directly. Every API call becomes
// `stripe get|post|delete <path> [-d k=v...] [-i <idempotency-key>]`, the
// documented full-coverage passthrough (docs.stripe.com/cli/get, /cli/post,
// /cli/delete) rather than the resource subcommands (`stripe customers ...`),
// whose per-resource operation names aren't fully enumerable from docs alone
// — using one fully-verified code path for every resource keeps this
// correct and testable instead of guessing at ~15 resources' verb sets.
//
// `--confirm` is passed to the underlying `stripe` process on mutating
// (POST/DELETE) calls only, so its own interactive "are you sure?" prompt
// never blocks a non-interactive run — that is a DIFFERENT flag from
// stripe-axi's own `--confirm` (see src/safety/gate.ts), which is what
// decided to invoke the CLI at all. `stripe get` never prompts and does not
// register the flag, so sending it there would be rejected as an unknown flag.
//
// The API key is handed to the child through its environment
// (STRIPE_API_KEY), never as an argv token: argv is world-readable in the
// process table on most systems, and a live key must not sit there. This
// still avoids depending on `stripe login` state.

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
  const args = [verb, req.path, "--color", "off"];
  if (req.method !== "GET") args.push("--confirm");
  for (const p of flattenParams(req.params ?? {})) args.push("-d", p);
  if (req.method === "POST" && req.idempotencyKey) args.push("-i", req.idempotencyKey);
  return args;
}

/** Quotes one argv token so the rendered command means the same thing in a shell. */
function shellQuote(arg: string): string {
  if (/^[A-Za-z0-9_@%+=:,./-]+$/.test(arg)) return arg;
  if (/[\x00-\x1f]/.test(arg)) {
    const escaped = arg
      .replace(/\\/g, "\\\\")
      .replace(/'/g, "\\'")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t")
      .replace(/[\x00-\x1f]/g, (c) => `\\x${c.charCodeAt(0).toString(16).padStart(2, "0")}`);
    return `$'${escaped}'`;
  }
  return "'" + arg.replace(/'/g, "'\\''") + "'";
}

/** Renders the equivalent shell command for dry-run display — the API key is never included. */
export function renderCliCommand(req: Omit<CliRequest, "apiKey">): string {
  return ["STRIPE_API_KEY=<redacted>", "stripe", ...buildCliArgs(req).map(shellQuote)].join(" ");
}

export interface CliResult {
  stdout: string;
  stderr: string;
  code: number | null;
}

/**
 * Isolated so tests can inject a fake spawn function without a real `stripe`
 * binary. `apiKey`, when given, is passed to the child via STRIPE_API_KEY
 * rather than argv. Output chunks are concatenated as bytes and decoded once
 * at the end: a multi-byte UTF-8 character split across a pipe chunk boundary
 * would otherwise decode to replacement characters and break JSON.parse.
 */
export function execStripeCli(args: string[], spawnFn: SpawnFn = nodeSpawn, apiKey?: string): Promise<CliResult> {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnFn(STRIPE_CLI_BIN, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: apiKey ? { ...process.env, STRIPE_API_KEY: apiKey } : process.env,
      });
    } catch (err) {
      reject(mapSpawnError(err));
      return;
    }
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const collect = (chunks: Buffer[]) => (d: unknown) =>
      chunks.push(Buffer.isBuffer(d) ? d : Buffer.from(String(d), "utf8"));
    child.stdout.on("data", collect(stdout));
    child.stderr.on("data", collect(stderr));
    child.on("error", (err) => reject(mapSpawnError(err)));
    child.on("close", (code) =>
      resolve({
        stdout: Buffer.concat(stdout).toString("utf8"),
        stderr: Buffer.concat(stderr).toString("utf8"),
        code,
      }),
    );
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
  const result = await execStripeCli(buildCliArgs(req), spawnFn, req.apiKey);
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
