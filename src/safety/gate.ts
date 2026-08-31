// The safety gate every mutating/money-moving command routes through.
//
// Model (see README "Money & live mode"):
//   1. No --confirm            -> dry-run: print the exact `stripe` command that
//                                 would run, no subprocess call.
//   2. --confirm, TEST mode    -> executes (shells out to the Stripe CLI).
//   3. --confirm, LIVE mode    -> still refused; needs --i-understand-this-is-live too.
//   4. --confirm + live-ack    -> executes.
//
// Every real write carries a deterministic Idempotency-Key, so a repeat of an
// identical invocation is replayed by Stripe rather than executed twice. That
// is the point, but it must never LOOK like a fresh execution: a replayed
// creation is labelled as such in the output (see isIdempotentReplay).
//
// --confirm ALONE must never be sufficient to move real money in live mode.

import type { KeyInfo, KeyMode } from "../stripe/config.js";
import { renderCliCommand, stripeCliRequest, type CliMethod } from "../stripe/cli.js";
import { deriveIdempotencyKey } from "./idempotency.js";
import { UsageError } from "../output/errors.js";
import { emitBlock, emitKV, print, toonValue } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";

export const CONFIRM_FLAG = {
  name: "confirm",
  type: "boolean" as const,
  description: "execute for real (default is a dry-run print of what would happen)",
};

export const LIVE_ACK_FLAG = {
  name: "i-understand-this-is-live",
  type: "boolean" as const,
  description: "second acknowledgement required for --confirm to take effect in LIVE mode",
};

export interface PlannedWrite {
  /** Stable operation name for idempotency-key derivation, e.g. "refund.create". */
  operation: string;
  /** One-line human description, e.g. "refund ch_123 amount=500". */
  description: string;
  method: Extract<CliMethod, "POST" | "DELETE">;
  path: string;
  params?: Record<string, unknown>;
  /** Money leaving/moving in the account — gets extra-loud dry-run wording. */
  movesMoney?: boolean;
  /**
   * True when the response is an object this call brings into existence
   * (refund, payout, customer, session): its `created` timestamp then dates
   * THIS execution, which is what makes replay detection possible below.
   * Capture/void/cancel/update responses carry the target object's original
   * `created`, so the same check would be meaningless there.
   */
  createsObject?: boolean;
}

/**
 * Stripe replays the stored response for a repeated Idempotency-Key within
 * ~24h instead of executing again. A freshly created object is always
 * timestamped ~now, so a `created` older than this margin (generous enough
 * for request latency and clock skew) means the response is a replay.
 */
const REPLAY_AGE_SECONDS = 30;

function isIdempotentReplay(plan: PlannedWrite, result: any): boolean {
  if (!plan.createsObject || plan.method !== "POST") return false;
  const created = result?.created;
  if (typeof created !== "number") return false;
  return Math.floor(Date.now() / 1000) - created > REPLAY_AGE_SECONDS;
}

export interface GateContext {
  keyInfo: KeyInfo;
  confirm: boolean;
  liveAck: boolean;
}

function printDryRun(plan: PlannedWrite, mode: KeyMode, idempotencyKey: string): void {
  const moneyNote = plan.movesMoney ? " — this MOVES MONEY when executed" : "";
  print(`dry-run: ${toonValue(`${plan.description} (not executed — pass --confirm to run)${moneyNote}`)}`);
  print(emitKV([["mode", mode.toUpperCase()]]));
  print(emitBlock("command", [
    renderCliCommand({ method: plan.method, path: plan.path, params: plan.params, idempotencyKey }),
  ]));
  const next =
    mode === "live"
      ? "re-run with --confirm --i-understand-this-is-live to execute in LIVE mode"
      : "re-run with --confirm to execute";
  print(helpBlock([next]));
}

/**
 * Runs a gated mutation end-to-end: dry-run by default, live-mode double-ack,
 * Idempotency-Key on every real write. Returns the process exit code.
 */
export async function runGatedWrite(
  ctx: GateContext,
  plan: PlannedWrite,
  onSuccess: (result: any) => void,
): Promise<number> {
  const idempotencyKey = deriveIdempotencyKey({
    operation: plan.operation,
    method: plan.method,
    path: plan.path,
    params: plan.params,
  });

  if (!ctx.confirm) {
    printDryRun(plan, ctx.keyInfo.mode, idempotencyKey);
    return 0;
  }

  if (ctx.keyInfo.mode === "live" && !ctx.liveAck) {
    throw new UsageError(
      `refusing to run '${plan.operation}' in LIVE mode: --confirm alone is not enough`,
      "add --i-understand-this-is-live alongside --confirm to execute this in LIVE mode",
    );
  }

  const result = await stripeCliRequest({
    method: plan.method,
    path: plan.path,
    params: plan.params,
    idempotencyKey,
    apiKey: ctx.keyInfo.key,
  });
  const replayed = isIdempotentReplay(plan, result);
  if (replayed) {
    print(
      "replay: REPLAY of a prior identical operation (not freshly executed) - Stripe returned the stored result for this Idempotency-Key",
    );
  }
  onSuccess(result);
  if (replayed) {
    print(helpBlock([
      "nothing new happened; the object shown above was created by an earlier identical run",
      "to perform a genuinely separate operation, change a parameter (e.g. --amount) or wait for the ~24h key window to lapse",
    ]));
  }
  return 0;
}
