import { makeDetailCommand, makeGatedCommand, makeListCommand, parseAmount, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

const FIELDS = ["id", "amount", "currency", "status", "customer", "created", "description"];

export const paymentsList = makeListCommand({
  name: "payments",
  summary: "List payment intents",
  path: "/v1/payment_intents",
  fields: FIELDS,
  defaultFields: "id,amount,status,customer,created",
  extraFlags: [{ name: "customer", type: "string", description: "filter by customer ID" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    customer: flags["customer"],
  }),
  mapRow: (p) => ({
    id: p.id,
    amount: formatAmount(p.amount, p.currency),
    currency: p.currency,
    status: p.status,
    customer: p.customer ?? "",
    created: formatUnixTime(p.created),
    description: p.description ?? "",
  }),
  examples: ["stripe-axi payments", "stripe-axi payments --customer cus_123"],
  emptyContext: (flags) => (flags["customer"] ? `customer=${flags["customer"]}` : "no filters"),
  suggestions: () => ["stripe-axi payment <id>"],
});

export const paymentDetail = makeDetailCommand({
  name: "payment",
  summary: "Show a single payment intent",
  argName: "id",
  path: (id) => `/v1/payment_intents/${id}`,
  render: (p, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", p.id],
      ["amount", formatAmount(p.amount, p.currency)],
      ["status", p.status],
      ["customer", p.customer ?? ""],
      ["latest_charge", p.latest_charge ?? ""],
      ["created", formatUnixTime(p.created)],
      ["description", p.description ?? ""],
    ]));
  },
  examples: ["stripe-axi payment pi_123"],
  suggestions: (id) => [`stripe-axi payment capture ${id} --confirm`, `stripe-axi payment cancel ${id} --confirm`],
});

export const paymentCapture = makeGatedCommand({
  name: "payment capture",
  summary: "Capture a payment intent that requires capture",
  args: [{ name: "id", required: true, description: "the payment intent ID" }],
  extraFlags: [{ name: "amount", type: "string", description: "amount to capture in cents (default: full authorized amount)" }],
  examples: ["stripe-axi payment capture pi_123 --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const rawAmount = parsed.flags["amount"] as string | undefined;
    const amount = rawAmount === undefined ? undefined : parseAmount(rawAmount);
    return {
      operation: "payment_intent.capture",
      description: `capture payment intent ${id}${amount ? ` amount_to_capture=${amount}` : ""}`,
      method: "POST",
      path: `/v1/payment_intents/${id}/capture`,
      params: amount ? { amount_to_capture: amount } : {},
      movesMoney: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`captured: payment intent ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["status", result.status]]));
  },
});

export const paymentCancel = makeGatedCommand({
  name: "payment cancel",
  summary: "Cancel a payment intent that has not yet succeeded",
  args: [{ name: "id", required: true, description: "the payment intent ID" }],
  extraFlags: [{ name: "reason", type: "string", description: "cancellation_reason (e.g. requested_by_customer, duplicate, fraudulent)" }],
  examples: ["stripe-axi payment cancel pi_123 --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const reason = parsed.flags["reason"] as string | undefined;
    return {
      operation: "payment_intent.cancel",
      description: `cancel payment intent ${id}${reason ? ` reason=${reason}` : ""}`,
      method: "POST",
      path: `/v1/payment_intents/${id}/cancel`,
      params: reason ? { cancellation_reason: reason } : {},
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`canceled: payment intent ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["status", result.status]]));
  },
});
