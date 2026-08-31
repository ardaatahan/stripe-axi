import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "product", "active", "unit_amount", "currency", "type", "nickname"];

export const pricesList = makeListCommand({
  name: "prices",
  summary: "List prices",
  path: "/v1/prices",
  fields: FIELDS,
  defaultFields: "id,product,active,unit_amount",
  extraFlags: [
    { name: "product", type: "string", description: "filter by product ID" },
    { name: "active", type: "string", values: ["true", "false"], description: "filter by active status" },
  ],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    product: flags["product"],
    active: flags["active"],
  }),
  mapRow: (p) => ({
    id: p.id,
    product: p.product,
    active: p.active,
    unit_amount: formatAmount(p.unit_amount, p.currency),
    currency: p.currency,
    type: p.type,
    nickname: p.nickname ?? "",
  }),
  examples: ["stripe-axi prices", "stripe-axi prices --product prod_123"],
  emptyContext: (flags) => (flags["product"] ? `product=${flags["product"]}` : "no filters"),
  suggestions: () => ["stripe-axi price <id>"],
});

export const priceDetail = makeDetailCommand({
  name: "price",
  summary: "Show a single price",
  argName: "id",
  path: (id) => `/v1/prices/${id}`,
  render: (p, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", p.id],
      ["product", p.product],
      ["active", p.active],
      ["unit_amount", formatAmount(p.unit_amount, p.currency)],
      ["type", p.type],
      ["nickname", p.nickname ?? ""],
      ["recurring_interval", p.recurring?.interval ?? ""],
    ]));
  },
  examples: ["stripe-axi price price_123"],
  suggestions: (id) => [`stripe-axi price update ${id} --active false --confirm`],
});

// Note: Stripe prices are immutable once created - unit_amount cannot be
// changed via update. Only active/nickname/metadata/tax_behavior are.
export const priceUpdate = makeGatedCommand({
  name: "price update",
  summary: "Update a price's active status or nickname (amount is immutable)",
  args: [{ name: "id", required: true, description: "the price ID" }],
  extraFlags: [
    { name: "active", type: "string", values: ["true", "false"], description: "new active status" },
    { name: "nickname", type: "string", description: "new internal nickname" },
  ],
  examples: ["stripe-axi price update price_123 --active false --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const active = parsed.flags["active"] as string | undefined;
    const nickname = parsed.flags["nickname"] as string | undefined;
    if (active === undefined && !nickname) {
      throw new UsageError("price update requires --active or --nickname", "stripe-axi price update <id> --active false --confirm");
    }
    return {
      operation: "price.update",
      description: `update price ${id}`,
      method: "POST",
      path: `/v1/prices/${id}`,
      params: { active, nickname },
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`updated: price ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["active", result.active]]));
  },
});
