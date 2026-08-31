import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

const FIELDS = ["id", "customer", "status", "amount_due", "amount_paid", "created"];

export const invoicesList = makeListCommand({
  name: "invoices",
  summary: "List invoices",
  path: "/v1/invoices",
  fields: FIELDS,
  defaultFields: "id,customer,status,amount_due,created",
  extraFlags: [
    { name: "customer", type: "string", description: "filter by customer ID" },
    { name: "status", type: "string", description: "filter by status (draft, open, paid, uncollectible, void)" },
  ],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    customer: flags["customer"],
    status: flags["status"],
  }),
  mapRow: (i) => ({
    id: i.id,
    customer: i.customer ?? "",
    status: i.status,
    amount_due: formatAmount(i.amount_due, i.currency),
    amount_paid: formatAmount(i.amount_paid, i.currency),
    created: formatUnixTime(i.created),
  }),
  examples: ["stripe-axi invoices", "stripe-axi invoices --customer cus_123 --status open"],
  emptyContext: (flags) => (flags["customer"] ? `customer=${flags["customer"]}` : "no filters"),
  suggestions: () => ["stripe-axi invoice <id>"],
});

export const invoiceDetail = makeDetailCommand({
  name: "invoice",
  summary: "Show a single invoice",
  argName: "id",
  path: (id) => `/v1/invoices/${id}`,
  render: (i, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", i.id],
      ["customer", i.customer ?? ""],
      ["status", i.status],
      ["amount_due", formatAmount(i.amount_due, i.currency)],
      ["amount_paid", formatAmount(i.amount_paid, i.currency)],
      ["number", i.number ?? ""],
      ["hosted_invoice_url", i.hosted_invoice_url ?? ""],
      ["created", formatUnixTime(i.created)],
    ]));
  },
  examples: ["stripe-axi invoice in_123"],
  suggestions: (id) => [`stripe-axi invoice void ${id} --confirm`],
});

export const invoiceVoid = makeGatedCommand({
  name: "invoice void",
  summary: "Void an open invoice (cannot be undone)",
  args: [{ name: "id", required: true, description: "the invoice ID" }],
  examples: ["stripe-axi invoice void in_123 --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    return {
      operation: "invoice.void",
      description: `void invoice ${id}`,
      method: "POST",
      path: `/v1/invoices/${id}/void`,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`voided: invoice ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["status", result.status]]));
  },
});
