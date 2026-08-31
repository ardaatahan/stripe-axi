import { readFileSync } from "node:fs";
import type { CommandModule } from "../cli/router.js";
import { emitKV, emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { commandTable, renderHome, rootHelpText } from "../skill/content.js";
import { loadKey } from "../stripe/config.js";
import { isStripeCliInstalled, stripeCliRequest, STRIPE_CLI_INSTALL_HINT } from "../stripe/cli.js";
import { formatAmount, formatUnixTime } from "../stripe/format.js";

/** The package manifest is the only source of truth for the version. */
function toolVersion(): string {
  try {
    const manifest = JSON.parse(readFileSync(new URL("../../package.json", import.meta.url), "utf8"));
    return String(manifest.version ?? "unknown");
  } catch {
    return "unknown";
  }
}

export const homeCommand: CommandModule = {
  spec: {
    name: "",
    summary: "Home view: live content first (AXI principle 8)",
    flags: [
      { name: "version", type: "boolean", description: "print the tool version" },
    ],
    examples: ["stripe-axi", "stripe-axi --version"],
  },
  async run(parsed) {
    if (parsed.flags["version"]) {
      print(`stripe-axi: ${toolVersion()}`);
      return 0;
    }

    const cliInstalled = await isStripeCliInstalled();
    const { info: keyInfo, source } = loadKey();

    const keySummary = keyInfo
      ? `${keyInfo.prefix}•••• (from ${source === "env" ? "STRIPE_API_KEY" : "~/.config/stripe-axi/credentials"})`
      : "none found";

    if (!cliInstalled) {
      print("stripe-axi: the official Stripe CLI is not installed");
      if (keyInfo) {
        print(emitKV([
          ["mode", keyInfo.mode.toUpperCase()],
          ["key", keySummary],
          ["stripe-cli", "not installed"],
        ]));
      }
      print(helpBlock([STRIPE_CLI_INSTALL_HINT]));
      print(keyInfo ? commandTable() : renderHome(process.argv[1] ?? "stripe-axi"));
      return 0;
    }

    if (!keyInfo) {
      print(renderHome(process.argv[1] ?? "stripe-axi"));
      return 0;
    }

    print(emitKV([
      ["mode", keyInfo.mode.toUpperCase()],
      ["key", keySummary],
      ["stripe-cli", "installed"],
    ]));

    try {
      const balance = await stripeCliRequest({ method: "GET", path: "/v1/balance", apiKey: keyInfo.key });
      const available = (balance.available ?? []).map((e: any) => ({
        status: "available",
        amount: formatAmount(e.amount, e.currency),
        currency: e.currency,
      }));
      print(emitList("balance", available, ["status", "amount", "currency"]));
    } catch {
      print("balance: unavailable (check the key is valid)");
    }

    try {
      const charges = await stripeCliRequest({ method: "GET", path: "/v1/charges", params: { limit: 5 }, apiKey: keyInfo.key });
      const rows = (charges.data ?? []).map((c: any) => ({
        id: c.id,
        amount: formatAmount(c.amount, c.currency),
        status: c.status,
        created: formatUnixTime(c.created),
      }));
      if (rows.length === 0) {
        print("charges: 0 recent charges found");
      } else {
        print(emitList("recent_charges", rows, ["id", "amount", "status", "created"]));
      }
    } catch {
      print("charges: unavailable");
    }

    print(helpBlock([
      "stripe-axi charges --limit 20",
      "stripe-axi customers",
      "stripe-axi --help",
    ]));
    return 0;
  },
};

export function rootHelp(): string {
  return rootHelpText();
}
