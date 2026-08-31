import { makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";
import { CONFIRM_FLAG, LIVE_ACK_FLAG, runGatedWrite } from "../safety/gate.js";
import { requireKey } from "../stripe/config.js";
import { UsageError } from "../output/errors.js";
import type { CommandModule } from "../cli/router.js";

const FIELDS = ["id", "charge", "amount", "currency", "status", "reason", "created"];

export const refundsList = makeListCommand({
  name: "refunds",
  summary: "List refunds",
  path: "/v1/refunds",
  fields: FIELDS,
  defaultFields: "id,charge,amount,status,created",
  extraFlags: [{ name: "charge", type: "string", description: "filter by charge ID" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    charge: flags["charge"],
  }),
  mapRow: (r) => ({
    id: r.id,
    charge: r.charge ?? "",
    amount: formatAmount(r.amount, r.currency),
    currency: r.currency,
    status: r.status,
    reason: r.reason ?? "",
    created: formatUnixTime(r.created),
  }),
  examples: ["stripe-axi refunds", "stripe-axi refunds --charge ch_123"],
  emptyContext: (flags) => (flags["charge"] ? `charge=${flags["charge"]}` : "no filters"),
  suggestions: () => ["stripe-axi refund <charge-or-payment-intent-id> --amount <cents> --confirm"],
});

// Refunds move money OUT of the account, so this is a hand-rolled gated
// command (not makeGatedCommand) to add the extra-loud money-moving copy
// called for by the brief rather than reusing the generic wording.
export const refundCreate: CommandModule = {
  spec: {
    name: "refund",
    summary: "Refund a charge or payment intent (MOVES MONEY OUT of the account)",
    args: [{ name: "id", required: true, description: "the charge (ch_...) or payment intent (pi_...) ID to refund" }],
    flags: [
      { name: "amount", type: "string", description: "amount to refund in cents (default: full amount)" },
      { name: "reason", type: "string", description: "duplicate, fraudulent, or requested_by_customer" },
      CONFIRM_FLAG,
      LIVE_ACK_FLAG,
    ],
    examples: [
      "stripe-axi refund ch_123 --confirm",
      "stripe-axi refund pi_123 --amount 500 --confirm",
      "stripe-axi refund ch_123 --confirm --i-understand-this-is-live",
    ],
  },
  async run(parsed) {
    const id = parsed.positionals[0]!;
    const amount = parsed.flags["amount"] as string | undefined;
    const reason = parsed.flags["reason"] as string | undefined;
    if (reason && !["duplicate", "fraudulent", "requested_by_customer"].includes(reason)) {
      throw new UsageError(`invalid --reason '${reason}'`, "valid values: duplicate, fraudulent, requested_by_customer");
    }
    const keyInfo = requireKey();
    const params: Record<string, unknown> = { amount };
    if (id.startsWith("pi_")) params.payment_intent = id;
    else params.charge = id;
    if (reason) params.reason = reason;

    const confirm = Boolean(parsed.flags["confirm"]);
    const liveAck = Boolean(parsed.flags["i-understand-this-is-live"]);
    return runGatedWrite(
      { keyInfo, confirm, liveAck },
      {
        operation: "refund.create",
        description: `refund ${id}${amount ? ` amount=${amount}` : " (full amount)"}`,
        method: "POST",
        path: "/v1/refunds",
        params,
        movesMoney: true,
        createsObject: true,
      },
      (result) => {
        print(`refunded: ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
        print(emitKV([
          ["amount", formatAmount(result.amount, result.currency)],
          ["status", result.status],
          ["charge", result.charge ?? ""],
        ]));
      },
    );
  },
};
