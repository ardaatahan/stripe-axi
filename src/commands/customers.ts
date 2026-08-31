import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatUnixTime } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "email", "name", "description", "created", "delinquent"];

export const customersList = makeListCommand({
  name: "customers",
  summary: "List customers",
  path: "/v1/customers",
  fields: FIELDS,
  defaultFields: "id,email,name,created",
  extraFlags: [{ name: "email", type: "string", description: "filter by exact email" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    email: flags["email"],
  }),
  mapRow: (c) => ({
    id: c.id,
    email: c.email ?? "",
    name: c.name ?? "",
    description: c.description ?? "",
    created: formatUnixTime(c.created),
    delinquent: c.delinquent,
  }),
  examples: ["stripe-axi customers", "stripe-axi customers --email jane@example.com"],
  emptyContext: (flags) => (flags["email"] ? `email=${flags["email"]}` : "no filters"),
  suggestions: () => ["stripe-axi customer <id>", "stripe-axi customer add --email <email> --confirm"],
});

export const customerDetail = makeDetailCommand({
  name: "customer",
  summary: "Show a single customer",
  argName: "id",
  path: (id) => `/v1/customers/${id}`,
  render: (c, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", c.id],
      ["email", c.email ?? ""],
      ["name", c.name ?? ""],
      ["description", c.description ?? ""],
      ["balance", c.balance],
      ["delinquent", c.delinquent],
      ["created", formatUnixTime(c.created)],
    ]));
  },
  examples: ["stripe-axi customer cus_123"],
  suggestions: (id) => [`stripe-axi subscriptions --customer ${id}`, `stripe-axi customer rm ${id} --confirm`],
});

export const customerAdd = makeGatedCommand({
  name: "customer add",
  summary: "Create a new customer",
  extraFlags: [
    { name: "email", type: "string", description: "customer email" },
    { name: "name", type: "string", description: "customer name" },
    { name: "description", type: "string", description: "internal description" },
  ],
  examples: [
    "stripe-axi customer add --email jane@example.com --name 'Jane Doe' --confirm",
  ],
  build: (parsed) => {
    const email = parsed.flags["email"] as string | undefined;
    const name = parsed.flags["name"] as string | undefined;
    const description = parsed.flags["description"] as string | undefined;
    if (!email && !name) {
      throw new UsageError("customer add requires at least --email or --name", "stripe-axi customer add --email <email> --confirm");
    }
    return {
      operation: "customer.create",
      description: `create customer${email ? ` email=${email}` : ""}${name ? ` name=${name}` : ""}`,
      method: "POST",
      path: "/v1/customers",
      params: { email, name, description },
      createsObject: true,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`created: customer ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["email", result.email ?? ""], ["name", result.name ?? ""]]));
  },
});

export const customerRm = makeGatedCommand({
  name: "customer rm",
  summary: "Permanently delete a customer",
  args: [{ name: "id", required: true, description: "the customer ID" }],
  examples: ["stripe-axi customer rm cus_123 --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    return {
      operation: "customer.delete",
      description: `delete customer ${id}`,
      method: "DELETE",
      path: `/v1/customers/${id}`,
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`deleted: customer ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
  },
});
