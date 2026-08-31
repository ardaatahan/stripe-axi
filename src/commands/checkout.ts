import { makeListCommand, parseLimit } from "./factory.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

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
  suggestions: () => ["stripe-axi payment-links", "stripe-axi payments"],
});
