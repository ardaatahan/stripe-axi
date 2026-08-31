import { makeDetailCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

const FIELDS = ["id", "charge", "amount", "currency", "status", "reason", "created"];

export const disputesList = makeListCommand({
  name: "disputes",
  summary: "List disputes",
  path: "/v1/disputes",
  fields: FIELDS,
  defaultFields: "id,charge,amount,status,created",
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
  }),
  mapRow: (d) => ({
    id: d.id,
    charge: d.charge ?? "",
    amount: formatAmount(d.amount, d.currency),
    currency: d.currency,
    status: d.status,
    reason: d.reason ?? "",
    created: formatUnixTime(d.created),
  }),
  examples: ["stripe-axi disputes"],
  emptyContext: () => "no filters",
  suggestions: () => ["stripe-axi dispute <id>"],
});

export const disputeDetail = makeDetailCommand({
  name: "dispute",
  summary: "Show a single dispute",
  argName: "id",
  path: (id) => `/v1/disputes/${id}`,
  render: (d, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", d.id],
      ["charge", d.charge ?? ""],
      ["amount", formatAmount(d.amount, d.currency)],
      ["status", d.status],
      ["reason", d.reason ?? ""],
      ["evidence_due_by", formatUnixTime(d.evidence_details?.due_by)],
      ["created", formatUnixTime(d.created)],
    ]));
  },
  examples: ["stripe-axi dispute dp_123"],
  suggestions: () => ["stripe-axi disputes"],
});
