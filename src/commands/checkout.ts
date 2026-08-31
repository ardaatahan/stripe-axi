import { makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "mode", "status", "amount_total", "currency", "created"];

export const checkoutSessionsList = makeListCommand({
  name: "checkout sessions",
  summary: "List Checkout Sessions",
  path: "/v1/checkout/sessions",
  fields: FIELDS,
  defaultFields: "id,mode,status,amount_total,created",
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
  }),
  mapRow: (s) => ({
    id: s.id,
    mode: s.mode,
    status: s.status,
    amount_total: formatAmount(s.amount_total, s.currency),
    currency: s.currency,
    created: formatUnixTime(s.created),
  }),
  examples: ["stripe-axi checkout sessions"],
  emptyContext: () => "no filters",
  suggestions: () => ["stripe-axi checkout create --price <id> --quantity 1 --success-url <url> --cancel-url <url> --confirm"],
});

export const checkoutCreate = makeGatedCommand({
  name: "checkout create",
  summary: "Create a Checkout Session (a hosted payment page URL)",
  extraFlags: [
    { name: "price", type: "string", description: "price ID for the line item (required)" },
    { name: "quantity", type: "string", default: "1", description: "line item quantity" },
    { name: "mode", type: "string", default: "payment", values: ["payment", "subscription", "setup"], description: "session mode" },
    { name: "success-url", type: "string", description: "redirect URL on success (required)" },
    { name: "cancel-url", type: "string", description: "redirect URL if the customer cancels" },
    { name: "customer", type: "string", description: "existing customer ID to attach" },
  ],
  examples: [
    "stripe-axi checkout create --price price_123 --success-url https://example.com/success --confirm",
  ],
  build: (parsed) => {
    const price = parsed.flags["price"] as string | undefined;
    const successUrl = parsed.flags["success-url"] as string | undefined;
    if (!price || !successUrl) {
      throw new UsageError(
        "checkout create requires --price and --success-url",
        "stripe-axi checkout create --price <id> --success-url <url> --confirm",
      );
    }
    const quantity = String(parsed.flags["quantity"] ?? "1");
    const mode = String(parsed.flags["mode"] ?? "payment");
    const cancelUrl = parsed.flags["cancel-url"] as string | undefined;
    const customer = parsed.flags["customer"] as string | undefined;
    return {
      operation: "checkout_session.create",
      description: `create checkout session price=${price} mode=${mode}`,
      method: "POST",
      path: "/v1/checkout/sessions",
      params: {
        mode,
        success_url: successUrl,
        cancel_url: cancelUrl,
        customer,
        line_items: [{ price, quantity }],
      },
      createsObject: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`created: checkout session ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["url", result.url ?? ""], ["status", result.status]]));
  },
});
