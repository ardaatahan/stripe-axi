import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatUnixTime } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "customer", "status", "cancel_at_period_end", "created"];

export const subscriptionsList = makeListCommand({
  name: "subscriptions",
  summary: "List subscriptions",
  path: "/v1/subscriptions",
  fields: FIELDS,
  defaultFields: "id,customer,status,created",
  extraFlags: [
    { name: "customer", type: "string", description: "filter by customer ID" },
    { name: "status", type: "string", description: "filter by status (active, past_due, canceled, trialing, ...)" },
  ],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    customer: flags["customer"],
    status: flags["status"],
  }),
  mapRow: (s) => ({
    id: s.id,
    customer: s.customer ?? "",
    status: s.status,
    cancel_at_period_end: s.cancel_at_period_end,
    created: formatUnixTime(s.created),
  }),
  examples: ["stripe-axi subscriptions", "stripe-axi subscriptions --customer cus_123 --status active"],
  emptyContext: (flags) => (flags["customer"] ? `customer=${flags["customer"]}` : "no filters"),
  suggestions: () => ["stripe-axi subscription <id>", "stripe-axi subscription cancel <id> --confirm"],
});

export const subscriptionDetail = makeDetailCommand({
  name: "subscription",
  summary: "Show a single subscription",
  argName: "id",
  path: (id) => `/v1/subscriptions/${id}`,
  render: (s, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", s.id],
      ["customer", s.customer ?? ""],
      ["status", s.status],
      ["cancel_at_period_end", s.cancel_at_period_end],
      ["latest_invoice", s.latest_invoice ?? ""],
      ["created", formatUnixTime(s.created)],
    ]));
  },
  examples: ["stripe-axi subscription sub_123"],
  suggestions: (id) => [`stripe-axi subscription cancel ${id} --confirm`, `stripe-axi subscription cancel ${id} --at-period-end --confirm`],
});

export const subscriptionCancel = makeGatedCommand({
  name: "subscription cancel",
  summary: "Cancel a subscription (immediately, or at period end)",
  args: [{ name: "id", required: true, description: "the subscription ID" }],
  extraFlags: [
    { name: "at-period-end", type: "boolean", description: "schedule cancellation for period end instead of immediately" },
    { name: "invoice-now", type: "boolean", description: "invoice any un-invoiced usage immediately (immediate cancel only)" },
    { name: "prorate", type: "boolean", description: "credit remaining unused time (immediate cancel only)" },
  ],
  examples: [
    "stripe-axi subscription cancel sub_123 --confirm",
    "stripe-axi subscription cancel sub_123 --at-period-end --confirm",
  ],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const atPeriodEnd = Boolean(parsed.flags["at-period-end"]);
    if (atPeriodEnd) {
      const immediateOnly = ["invoice-now", "prorate"].filter((flag) => parsed.flags[flag]);
      if (immediateOnly.length > 0) {
        throw new UsageError(
          `--at-period-end cannot be combined with ${immediateOnly.map((flag) => `--${flag}`).join(" or ")}`,
          "invoice_now and prorate are parameters of Stripe's immediate cancel; drop --at-period-end to use them",
        );
      }
      return {
        operation: "subscription.cancel_at_period_end",
        description: `schedule subscription ${id} to cancel at period end`,
        method: "POST",
        path: `/v1/subscriptions/${id}`,
        params: { cancel_at_period_end: true },
      };
    }
    const invoiceNow = Boolean(parsed.flags["invoice-now"]);
    const prorate = Boolean(parsed.flags["prorate"]);
    return {
      operation: "subscription.cancel_immediately",
      description: `cancel subscription ${id} immediately`,
      method: "DELETE",
      path: `/v1/subscriptions/${id}`,
      params: { invoice_now: invoiceNow || undefined, prorate: prorate || undefined },
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`canceled: subscription ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["status", result.status], ["cancel_at_period_end", result.cancel_at_period_end]]));
  },
});
