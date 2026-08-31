import { makeDetailCommand, makeGatedCommand, makeListCommand, parseAmount, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "amount", "currency", "status", "arrival_date", "method", "created"];

export const payoutsList = makeListCommand({
  name: "payouts",
  summary: "List payouts",
  path: "/v1/payouts",
  fields: FIELDS,
  defaultFields: "id,amount,status,arrival_date",
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
  }),
  mapRow: (p) => ({
    id: p.id,
    amount: formatAmount(p.amount, p.currency),
    currency: p.currency,
    status: p.status,
    arrival_date: formatUnixTime(p.arrival_date),
    method: p.method,
    created: formatUnixTime(p.created),
  }),
  examples: ["stripe-axi payouts", "stripe-axi payouts --limit 20"],
  emptyContext: () => "no filters",
  suggestions: () => ["stripe-axi payout <id>"],
});

export const payoutDetail = makeDetailCommand({
  name: "payout",
  summary: "Show a single payout",
  argName: "id",
  path: (id) => `/v1/payouts/${id}`,
  render: (p, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", p.id],
      ["amount", formatAmount(p.amount, p.currency)],
      ["status", p.status],
      ["method", p.method],
      ["arrival_date", formatUnixTime(p.arrival_date)],
      ["created", formatUnixTime(p.created)],
    ]));
  },
  examples: ["stripe-axi payout po_123"],
  suggestions: () => ["stripe-axi payout create --amount <cents> --currency usd --confirm"],
});

// Payouts move money OUT of the Stripe account to the bank - per the brief,
// the single most guarded operation in the tool.
export const payoutCreate = makeGatedCommand({
  name: "payout create",
  summary: "Create a payout to your bank account (MOST GUARDED - moves money out)",
  extraFlags: [
    { name: "amount", type: "string", description: "amount in cents (required)" },
    { name: "currency", type: "string", default: "usd", description: "three-letter ISO currency code" },
  ],
  examples: [
    "stripe-axi payout create --amount 10000 --currency usd --confirm",
    "stripe-axi payout create --amount 10000 --confirm --i-understand-this-is-live",
  ],
  build: (parsed) => {
    const rawAmount = parsed.flags["amount"] as string | undefined;
    if (!rawAmount) {
      throw new UsageError("payout create requires --amount", "stripe-axi payout create --amount <cents> --currency usd --confirm");
    }
    const amount = parseAmount(rawAmount);
    const currency = String(parsed.flags["currency"] ?? "usd").toLowerCase();
    return {
      operation: "payout.create",
      description: `create payout amount=${amount} currency=${currency}`,
      method: "POST",
      path: "/v1/payouts",
      params: { amount, currency },
      movesMoney: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`created: payout ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([
      ["amount", formatAmount(result.amount, result.currency)],
      ["status", result.status],
      ["arrival_date", formatUnixTime(result.arrival_date)],
    ]));
  },
});
