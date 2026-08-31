// The safety gate every mutating/money-moving command routes through.
//
// Model (see README "Money & live mode"):
//   1. No --confirm            -> dry-run: print the exact `stripe` command that
//                                 would run, no subprocess call.
//   2. --confirm, TEST mode    -> executes (shells out to the Stripe CLI).
//   3. --confirm, LIVE mode    -> still refused; needs --i-understand-this-is-live too.
//   4. --confirm + live-ack    -> executes.
//
// --confirm ALONE must never be sufficient to move real money in live mode.

import type { KeyInfo, KeyMode } from "../stripe/config.js";
import { renderCliCommand, stripeCliRequest, type CliMethod } from "../stripe/cli.js";
import { deriveIdempotencyKey } from "./idempotency.js";
import { UsageError } from "../output/errors.js";
import { emitKV, print } from "../output/toon.js";
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
}

export interface GateContext {
  keyInfo: KeyInfo;
  confirm: boolean;
  liveAck: boolean;
}

function printDryRun(plan: PlannedWrite, mode: KeyMode, idempotencyKey: string): void {
  const moneyNote = plan.movesMoney ? " — this MOVES MONEY when executed" : "";
  print(`dry-run: ${plan.description} (not executed — pass --confirm to run)${moneyNote}`);
  print(emitKV([
    ["mode", mode.toUpperCase()],
    ["command", renderCliCommand({ method: plan.method, path: plan.path, params: plan.params, idempotencyKey })],
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
  const idempotencyKey = deriveIdempotencyKey(plan.operation, plan.params ?? {});

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
  onSuccess(result);
  return 0;
}
