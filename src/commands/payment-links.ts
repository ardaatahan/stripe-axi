import { makeListCommand, parseLimit } from "./factory.js";

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
  suggestions: () => ["stripe-axi checkout sessions", "stripe-axi prices"],
});
