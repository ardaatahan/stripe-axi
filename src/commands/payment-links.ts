import { makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "url", "active"];

export const paymentLinksList = makeListCommand({
  name: "payment-links",
  summary: "List payment links",
  path: "/v1/payment_links",
  fields: FIELDS,
  defaultFields: "id,url,active",
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
  }),
  mapRow: (l) => ({ id: l.id, url: l.url, active: l.active }),
  examples: ["stripe-axi payment-links"],
  emptyContext: () => "no filters",
  suggestions: () => ["stripe-axi payment-link create --price <id> --quantity 1 --confirm"],
});

export const paymentLinkCreate = makeGatedCommand({
  name: "payment-link create",
  summary: "Create a reusable payment link (a shareable hosted checkout URL)",
  extraFlags: [
    { name: "price", type: "string", description: "price ID for the line item (required)" },
    { name: "quantity", type: "string", default: "1", description: "line item quantity" },
  ],
  examples: ["stripe-axi payment-link create --price price_123 --confirm"],
  build: (parsed) => {
    const price = parsed.flags["price"] as string | undefined;
    if (!price) {
      throw new UsageError("payment-link create requires --price", "stripe-axi payment-link create --price <id> --confirm");
    }
    const quantity = String(parsed.flags["quantity"] ?? "1");
    return {
      operation: "payment_link.create",
      description: `create payment link price=${price} quantity=${quantity}`,
      method: "POST",
      path: "/v1/payment_links",
      params: { line_items: [{ price, quantity }] },
      createsObject: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`created: payment link ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["url", result.url ?? ""], ["active", result.active]]));
  },
});
