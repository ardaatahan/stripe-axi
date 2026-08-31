import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

const FIELDS = ["id", "amount", "currency", "status", "customer", "captured", "created", "description"];

export const chargesList = makeListCommand({
  name: "charges",
  summary: "List charges",
  path: "/v1/charges",
  fields: FIELDS,
  defaultFields: "id,amount,status,customer,created",
  extraFlags: [{ name: "customer", type: "string", description: "filter by customer ID" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    customer: flags["customer"],
  }),
  mapRow: (c) => ({
    id: c.id,
    amount: formatAmount(c.amount, c.currency),
    currency: c.currency,
    status: c.status,
    customer: c.customer ?? "",
    captured: c.captured,
    created: formatUnixTime(c.created),
    description: c.description ?? "",
  }),
  examples: ["stripe-axi charges", "stripe-axi charges --customer cus_123 --limit 20"],
  emptyContext: (flags) => (flags["customer"] ? `customer=${flags["customer"]}` : "no filters"),
  suggestions: () => ["stripe-axi charge <id>", "stripe-axi refund <charge-id> --amount <cents>"],
});

export const chargeDetail = makeDetailCommand({
  name: "charge",
  summary: "Show a single charge",
  argName: "id",
  path: (id) => `/v1/charges/${id}`,
  render: (c, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", c.id],
      ["amount", formatAmount(c.amount, c.currency)],
      ["status", c.status],
      ["captured", c.captured],
      ["refunded", c.refunded],
      ["customer", c.customer ?? ""],
      ["payment_intent", c.payment_intent ?? ""],
      ["created", formatUnixTime(c.created)],
      ["description", c.description ?? ""],
      ["receipt_url", c.receipt_url ?? ""],
    ]));
  },
  examples: ["stripe-axi charge ch_123"],
  suggestions: (id) => [`stripe-axi charge capture ${id} --confirm`, `stripe-axi refund ${id} --amount <cents> --confirm`],
});

export const chargeCapture = makeGatedCommand({
  name: "charge capture",
  summary: "Capture a previously authorized (uncaptured) charge",
  args: [{ name: "id", required: true, description: "the charge ID" }],
  extraFlags: [{ name: "amount", type: "string", description: "amount to capture in cents (default: full authorized amount)" }],
  examples: ["stripe-axi charge capture ch_123 --confirm", "stripe-axi charge capture ch_123 --amount 500 --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const amount = parsed.flags["amount"] as string | undefined;
    return {
      operation: "charge.capture",
      description: `capture charge ${id}${amount ? ` amount=${amount}` : ""}`,
      method: "POST",
      path: `/v1/charges/${id}/capture`,
      params: amount ? { amount } : {},
      movesMoney: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`captured: charge ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([
      ["amount_captured", formatAmount(result.amount_captured ?? result.amount, result.currency)],
      ["status", result.status],
    ]));
  },
});
