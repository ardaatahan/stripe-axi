import { makeDetailCommand, makeGatedCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatUnixTime } from "../stripe/format.js";
import { UsageError } from "../output/errors.js";

const FIELDS = ["id", "name", "active", "description", "default_price", "created"];

export const productsList = makeListCommand({
  name: "products",
  summary: "List products",
  path: "/v1/products",
  fields: FIELDS,
  defaultFields: "id,name,active,created",
  extraFlags: [{ name: "active", type: "string", values: ["true", "false"], description: "filter by active status" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    active: flags["active"],
  }),
  mapRow: (p) => ({
    id: p.id,
    name: p.name,
    active: p.active,
    description: p.description ?? "",
    default_price: p.default_price ?? "",
    created: formatUnixTime(p.created),
  }),
  examples: ["stripe-axi products", "stripe-axi products --active true"],
  emptyContext: (flags) => (flags["active"] ? `active=${flags["active"]}` : "no filters"),
  suggestions: () => ["stripe-axi product <id>", "stripe-axi prices"],
});

export const productDetail = makeDetailCommand({
  name: "product",
  summary: "Show a single product",
  argName: "id",
  path: (id) => `/v1/products/${id}`,
  render: (p, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", p.id],
      ["name", p.name],
      ["active", p.active],
      ["description", p.description ?? ""],
      ["default_price", p.default_price ?? ""],
      ["created", formatUnixTime(p.created)],
    ]));
  },
  examples: ["stripe-axi product prod_123"],
  suggestions: (id) => [`stripe-axi prices --product ${id}`, `stripe-axi product update ${id} --active false --confirm`],
});

export const productUpdate = makeGatedCommand({
  name: "product update",
  summary: "Update a product's name, description, or active status",
  args: [{ name: "id", required: true, description: "the product ID" }],
  extraFlags: [
    { name: "name", type: "string", description: "new name" },
    { name: "description", type: "string", description: "new description" },
    { name: "active", type: "string", values: ["true", "false"], description: "new active status" },
  ],
  examples: ["stripe-axi product update prod_123 --active false --confirm"],
  build: (parsed) => {
    const id = parsed.positionals[0]!;
    const name = parsed.flags["name"] as string | undefined;
    const description = parsed.flags["description"] as string | undefined;
    const active = parsed.flags["active"] as string | undefined;
    if (!name && !description && active === undefined) {
      throw new UsageError("product update requires at least one of --name, --description, --active", "stripe-axi product update <id> --active false --confirm");
    }
    return {
      operation: "product.update",
      description: `update product ${id}`,
      method: "POST",
      path: `/v1/products/${id}`,
      params: { name, description, active },
    };
  },
  onSuccess: (result, keyInfo) => {
    print(`updated: product ${result.id} (mode ${keyInfo.mode.toUpperCase()})`);
    print(emitKV([["active", result.active]]));
  },
});
