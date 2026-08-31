import { makeDetailCommand, makeListCommand, parseLimit } from "./factory.js";
import { emitKV, print } from "../output/toon.js";
import { formatUnixTime } from "../stripe/format.js";

const FIELDS = ["id", "type", "created", "livemode"];

export const eventsList = makeListCommand({
  name: "events",
  summary: "List recent events (great for debugging)",
  path: "/v1/events",
  fields: FIELDS,
  defaultFields: "id,type,created",
  extraFlags: [{ name: "type", type: "string", description: "filter by event type, e.g. charge.succeeded" }],
  buildParams: (flags) => ({
    limit: parseLimit(flags),
    starting_after: flags["starting-after"],
    type: flags["type"],
  }),
  mapRow: (e) => ({
    id: e.id,
    type: e.type,
    created: formatUnixTime(e.created),
    livemode: e.livemode,
  }),
  examples: ["stripe-axi events", "stripe-axi events --type charge.succeeded"],
  emptyContext: (flags) => (flags["type"] ? `type=${flags["type"]}` : "no filters"),
  suggestions: () => ["stripe-axi event <id>"],
});

export const eventDetail = makeDetailCommand({
  name: "event",
  summary: "Show a single event, including its data.object payload",
  argName: "id",
  path: (id) => `/v1/events/${id}`,
  render: (e, keyInfo) => {
    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    print(emitKV([
      ["id", e.id],
      ["type", e.type],
      ["created", formatUnixTime(e.created)],
      ["livemode", e.livemode],
      ["object_id", e.data?.object?.id ?? ""],
    ]));
  },
  examples: ["stripe-axi event evt_123"],
  suggestions: () => ["stripe-axi events --type <type>"],
});
