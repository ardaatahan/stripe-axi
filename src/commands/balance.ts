import type { CommandModule } from "../cli/router.js";
import { emitList, print } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";
import { requireKey } from "../stripe/config.js";
import { stripeCliRequest } from "../stripe/cli.js";
import { formatAmount } from "../stripe/format.js";

interface BalanceEntry {
  amount: number;
  currency: string;
  source_types?: Record<string, number>;
}

export const balanceCommand: CommandModule = {
  spec: {
    name: "balance",
    summary: "Available and pending balance by currency",
    flags: [],
    examples: ["stripe-axi balance"],
  },
  async run() {
    const keyInfo = requireKey();
    const result = await stripeCliRequest({ method: "GET", path: "/v1/balance", apiKey: keyInfo.key });
    const available: BalanceEntry[] = result.available ?? [];
    const pending: BalanceEntry[] = result.pending ?? [];

    const rows = [
      ...available.map((e) => ({ status: "available", amount: formatAmount(e.amount, e.currency), currency: e.currency })),
      ...pending.map((e) => ({ status: "pending", amount: formatAmount(e.amount, e.currency), currency: e.currency })),
    ];

    print(`mode: ${keyInfo.mode.toUpperCase()}`);
    if (rows.length === 0) {
      print("balance: 0 currencies found");
    } else {
      print(emitList("balance", rows, ["status", "amount", "currency"]));
    }
    print(helpBlock(["stripe-axi charges --limit 10", "stripe-axi payouts"]));
    return 0;
  },
};
