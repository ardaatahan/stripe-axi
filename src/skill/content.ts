// Single source for the static parts of the home view AND the generated
// SKILL.md (AXI principle 7): the full command reference and the no-key
// overview. The live home view (src/commands/home.ts) layers live balance
// and recent-activity data on top of this when a key is present.

import { homedir } from "node:os";
import { emitList } from "../output/toon.js";
import { helpBlock } from "../output/suggest.js";

export const DESCRIPTION =
  "AXI-compliant CLI for Stripe — inspect payments, customers, subscriptions, invoices, and balance; move money only under explicit, gated confirmation. Wraps the official Stripe CLI.";

export const SPEC_VERSION = "axi/1.0-2026-07";

export function collapseHome(path: string): string {
  const home = homedir();
  return path.startsWith(home) ? "~" + path.slice(home.length) : path;
}

export const COMMANDS: Array<{ command: string; summary: string }> = [
  { command: "balance", summary: "Available and pending balance by currency" },
  { command: "charges", summary: "List charges" },
  { command: "charge <id>", summary: "Show a single charge" },
  { command: "charge capture <id>", summary: "GATED: capture an authorized charge" },
  { command: "payments", summary: "List payment intents" },
  { command: "payment <id>", summary: "Show a single payment intent" },
  { command: "payment capture <id>", summary: "GATED: capture a payment intent" },
  { command: "payment cancel <id>", summary: "GATED: cancel a payment intent" },
  { command: "customers", summary: "List customers" },
  { command: "customer <id>", summary: "Show a single customer" },
  { command: "customer add", summary: "GATED: create a customer" },
  { command: "customer rm <id>", summary: "GATED: delete a customer" },
  { command: "subscriptions", summary: "List subscriptions" },
  { command: "subscription <id>", summary: "Show a single subscription" },
  { command: "subscription cancel <id>", summary: "GATED: cancel a subscription" },
  { command: "invoices", summary: "List invoices" },
  { command: "invoice <id>", summary: "Show a single invoice" },
  { command: "invoice void <id>", summary: "GATED: void an invoice" },
  { command: "refunds", summary: "List refunds" },
  { command: "refund <id>", summary: "GATED, MOVES MONEY: refund a charge or payment intent" },
  { command: "payouts", summary: "List payouts" },
  { command: "payout <id>", summary: "Show a single payout" },
  { command: "payout create", summary: "GATED, MOVES MONEY (most guarded): create a payout" },
  { command: "products", summary: "List products" },
  { command: "product <id>", summary: "Show a single product" },
  { command: "product update <id>", summary: "GATED: update a product" },
  { command: "prices", summary: "List prices" },
  { command: "price <id>", summary: "Show a single price" },
  { command: "price update <id>", summary: "GATED: update a price" },
  { command: "events", summary: "List recent events (debugging)" },
  { command: "event <id>", summary: "Show a single event" },
  { command: "disputes", summary: "List disputes" },
  { command: "dispute <id>", summary: "Show a single dispute" },
  { command: "checkout sessions", summary: "List Checkout Sessions" },
  { command: "checkout create", summary: "GATED: create a Checkout Session" },
  { command: "payment-links", summary: "List payment links" },
  { command: "payment-link create", summary: "GATED: create a payment link" },
];

/** The no-key / static overview: command table plus setup pointer. */
export function homeBody(tool: string): string {
  const table = emitList(
    "commands",
    COMMANDS.map((c) => ({ command: c.command, summary: c.summary })),
    ["command", "summary"],
  );
  const help = helpBlock([
    "export STRIPE_API_KEY=sk_test_... (get one at https://dashboard.stripe.com/apikeys)",
    `${tool} balance`,
    `${tool} --help`,
  ]);
  return [table, help].join("\n");
}

export function renderHome(binPath: string): string {
  const header = `stripe-axi: ${collapseHome(binPath)} — ${DESCRIPTION}`;
  return [header, "key: none found", homeBody("stripe-axi")].join("\n");
}

/** Full tool reference for `stripe-axi --help`. */
export function rootHelpText(): string {
  const commands = emitList("commands", COMMANDS, ["command", "summary"]);
  const flags = emitList(
    "flags",
    [
      { flag: "--help", default: "", description: "show help for any command" },
      { flag: "--version", default: "", description: "print the tool version" },
    ],
    ["flag", "default", "description"],
  );
  return [
    `stripe-axi: ${DESCRIPTION}`,
    commands,
    flags,
    "safety[3]:",
    "  every GATED command dry-runs by default; add --confirm to execute",
    "  LIVE-mode gated commands additionally require --i-understand-this-is-live",
    "  every write carries a deterministic Idempotency-Key so retries can't double-charge",
    "examples[3]:",
    "  stripe-axi balance",
    "  stripe-axi charges --limit 20",
    "  stripe-axi refund ch_123 --amount 500 --confirm",
  ].join("\n");
}

/** The static SKILL.md: home content with zero-install command forms. */
export function renderSkill(): string {
  const frontmatter = [
    "---",
    "name: stripe-axi",
    `description: "${DESCRIPTION.replace(/"/g, "'")}"`,
    "---",
  ].join("\n");
  const body = [
    "# stripe-axi",
    "",
    `${DESCRIPTION} (built against AXI spec ${SPEC_VERSION}). Run the commands below with npx — no install needed. Requires the official Stripe CLI ('stripe') on PATH and a STRIPE_API_KEY environment variable.`,
    "",
    "## Safety model (read this first)",
    "",
    "- **Read-only by default.** Every list/detail/balance/events command only reads data.",
    "- **Every mutating command dry-runs by default.** It prints the exact `stripe` command it would run and does nothing else. Add `--confirm` to actually execute it.",
    "- **LIVE mode needs a second acknowledgement.** If the active key is `sk_live_`/`rk_live_`, `--confirm` alone is refused — add `--i-understand-this-is-live` too. `--confirm` alone can never move real money in live mode.",
    "- **Idempotency-Key on every write**, derived deterministically from the command and its parameters, so re-running an identical `--confirm` can't double-charge.",
    "- Refunds and payouts (money leaving the account) are the most guarded commands.",
    "",
    "```",
    homeBody("npx -y stripe-axi"),
    "```",
    "",
    "Every command supports `--help`. Exit codes: 0 success/no-op, 1 error, 2 usage error. All output is TOON on stdout.",
  ].join("\n");
  return [frontmatter, "", body, ""].join("\n");
}
