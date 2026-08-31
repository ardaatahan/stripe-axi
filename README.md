# stripe-axi

An [AXI](https://axi.md)-compliant CLI for [Stripe](https://stripe.com), built against spec `axi/1.0-2026-07`. It wraps the **official Stripe CLI** (`stripe`) and makes its output agent-ergonomic — [TOON](https://axi.md) on stdout, structured errors, next-step suggestions — with a safety layer on top so an agent (or you) can inspect payments, customers, subscriptions, invoices, and balance freely, and move real money only under explicit, unambiguous confirmation.

stripe-axi is a token-efficient alternative to both the raw Stripe CLI and the [official Stripe MCP](https://mcp.stripe.com) (`npx -y @stripe/mcp`) for agent use: same underlying CLI, minimal structured output instead of a full JSON/table dump, and a safety model purpose-built for autonomous or semi-autonomous agents.

## Money & live mode — handle with care

**This tool touches real money. Read this section before running any command with `--confirm`.**

1. **Read-only by default.** `balance`, all list/detail commands, and `events` only read data — they can never move money or mutate state.
2. **Every mutating command dry-runs by default.** Without `--confirm`, it prints exactly what would happen — the equivalent `stripe` command, mode, and parameters — and makes no call at all. Nothing mutates until you pass `--confirm`.
3. **LIVE mode requires a second, explicit acknowledgement.** The active mode (TEST or LIVE) is detected from your key's prefix and shown on every invocation. If the key is `sk_live_`/`rk_live_`, `--confirm` alone is refused — you must also pass `--i-understand-this-is-live`. `--confirm` alone can never execute a write in live mode.
4. **Refunds and payouts (money leaving the account) are the most guarded commands** — both require `--confirm`, and in live mode, `--i-understand-this-is-live` too.
5. **Every mutating POST carries a deterministic Idempotency-Key**, derived from the command, the exact API request it makes (method and path, so two different invoices or charges never share a key), and its parameters. Re-running an identical `--confirm` invocation (e.g. after a network hiccup) reuses the same key, so Stripe treats it as a retry rather than a new charge — it cannot double-refund or double-payout. The two DELETE writes (`customer rm`, immediate `subscription cancel`) send no key: DELETE is idempotent by definition, and Stripe does not apply idempotency keys to it.
6. **A replayed write says so.** Because of (5), deliberately repeating an identical creation within Stripe's ~24h key window returns the first result instead of executing again. When that happens the output is labelled `REPLAY of a prior identical operation (not freshly executed)` rather than reading like a fresh success, so a repeated refund can never be mistaken for a second one. To perform a genuinely separate operation, change a parameter.

Example of the dry-run output:

```
$ stripe-axi refund ch_123 --amount 500
dry-run: refund ch_123 amount=500 (not executed — pass --confirm to run) — this MOVES MONEY when executed
mode: TEST
command: STRIPE_API_KEY=<redacted> stripe post /v1/refunds --color off --confirm -d amount=500 -d charge=ch_123 -i stripe-axi_refund.create_4100...
help[1]:
  re-run with --confirm to execute
```

**Strongly recommended:** start with a **TEST key** (`sk_test_...`). Everything in this README works identically in test mode with fake data — there's no need to touch a live key while exploring.

## Install

Requires:

- **Node.js 20+**
- **The official Stripe CLI** — stripe-axi shells out to it rather than reimplementing the Stripe API. Install with:
  ```sh
  brew install stripe/stripe-cli/stripe   # macOS/Linux via Homebrew
  npm install -g @stripe/cli              # cross-platform via npm
  ```
  See [docs.stripe.com/stripe-cli](https://docs.stripe.com/stripe-cli) for other platforms. If it's missing, stripe-axi tells you so clearly instead of crashing — it never assumes it's there.

Install stripe-axi itself:

```sh
npm install -g github:ardaatahan/stripe-axi
# or run it without installing:
npx -y github:ardaatahan/stripe-axi
```

## Key setup

stripe-axi reads your Stripe secret key from, in order:

1. the `STRIPE_API_KEY` environment variable
2. `~/.config/stripe-axi/credentials` (a file containing `STRIPE_API_KEY=sk_test_...`, or just the bare key)

```sh
export STRIPE_API_KEY=sk_test_...   # get one at https://dashboard.stripe.com/apikeys
stripe-axi balance
```

The active mode (TEST or LIVE) is detected from the key's prefix and shown on every invocation — `sk_test_`/`rk_test_` is TEST, `sk_live_`/`rk_live_` is LIVE. The key itself is never logged, echoed, or embedded in output; at most its safe prefix (e.g. `sk_test_`) is shown.

## Commands

Read-only (no confirmation needed):

| Command | Description |
| --- | --- |
| `stripe-axi` | Home view: mode, key, live balance, recent charges — or a compact overview without a key |
| `stripe-axi balance` | Available and pending balance by currency |
| `stripe-axi charges [--customer <id>] [--limit N]` | List charges |
| `stripe-axi charge <id>` | Show a single charge |
| `stripe-axi payments [--customer <id>]` | List payment intents |
| `stripe-axi payment <id>` | Show a single payment intent |
| `stripe-axi customers [--email <email>]` | List customers |
| `stripe-axi customer <id>` | Show a single customer |
| `stripe-axi subscriptions [--customer <id>] [--status <s>]` | List subscriptions |
| `stripe-axi subscription <id>` | Show a single subscription |
| `stripe-axi invoices [--customer <id>] [--status <s>]` | List invoices |
| `stripe-axi invoice <id>` | Show a single invoice |
| `stripe-axi refunds [--charge <id>]` | List refunds |
| `stripe-axi payouts` | List payouts |
| `stripe-axi payout <id>` | Show a single payout |
| `stripe-axi products [--active true\|false]` | List products |
| `stripe-axi product <id>` | Show a single product |
| `stripe-axi prices [--product <id>]` | List prices |
| `stripe-axi price <id>` | Show a single price |
| `stripe-axi events [--type <type>]` | List recent events (great for debugging) |
| `stripe-axi event <id>` | Show a single event |
| `stripe-axi disputes` | List disputes |
| `stripe-axi dispute <id>` | Show a single dispute |
| `stripe-axi checkout sessions` | List Checkout Sessions |
| `stripe-axi payment-links` | List payment links |

Gated (dry-run by default; see [Money & live mode](#money--live-mode--handle-with-care)):

| Command | Description |
| --- | --- |
| `stripe-axi charge capture <id> [--amount N] --confirm` | Capture an authorized charge |
| `stripe-axi payment capture <id> [--amount N] --confirm` | Capture a payment intent |
| `stripe-axi payment cancel <id> [--reason <r>] --confirm` | Cancel a payment intent |
| `stripe-axi customer add [--email] [--name] [--description] --confirm` | Create a customer |
| `stripe-axi customer rm <id> --confirm` | Delete a customer |
| `stripe-axi subscription cancel <id> [--at-period-end] --confirm` | Cancel a subscription |
| `stripe-axi invoice void <id> --confirm` | Void an open invoice |
| `stripe-axi refund <charge-or-pi-id> [--amount N] --confirm` | **Refund** (moves money out) |
| `stripe-axi payout create --amount N --currency usd --confirm` | **Create a payout** (moves money out — most guarded) |
| `stripe-axi product update <id> [--name] [--active] --confirm` | Update a product |
| `stripe-axi price update <id> [--active] [--nickname] --confirm` | Update a price (amount is immutable by design) |

### Not in v1: initiating charges or billing

**stripe-axi v1 is deliberately inspect + reverse/stop only.** It has no command that directly charges a customer or starts new billing, and that omission is a scope decision rather than a gap:

- no `charge create` / `payment_intent create`
- no `subscription create` / `subscription update`
- no `invoice create`
- no `checkout create` (Checkout Session) / `payment-link create`

The mutating surface is limited to inspecting, reversing (refund), completing an already-authorized charge (capture), stopping (cancel, void, delete), and updating catalog objects (product, price). Nothing in v1 can start a collection of money, including the hosted pages that would invite a customer to pay. Reading existing Checkout Sessions and payment links is supported (`stripe-axi checkout sessions`, `stripe-axi payment-links`); only creating them is deferred. An agent driving this tool therefore cannot initiate a charge, however it is prompted. These commands may be added later as a deliberate follow-up, behind the same gate.

Every command supports `--help` with flags, defaults, and examples. All output is [TOON](https://axi.md) on stdout. Exit codes: `0` success/no-op, `1` error, `2` usage error.

Examples:

```sh
stripe-axi balance
stripe-axi charges --customer cus_123 --limit 20
stripe-axi customer add --email jane@example.com --name "Jane Doe" --confirm
stripe-axi refund ch_123 --amount 500 --confirm
stripe-axi refund ch_123 --amount 500 --confirm --i-understand-this-is-live   # only needed with a live key
```

## Design notes

- **Wraps the official Stripe CLI, not the raw HTTP API.** Every call becomes `stripe get|post|delete <path> [-d k=v...] [-i <idempotency-key>]` — the CLI's documented full-API-coverage passthrough — rather than the per-resource subcommands (`stripe customers ...`). The passthrough's syntax is fully specified in the Stripe CLI docs for every resource, while resource-command operation names are dynamically introspected per resource (`stripe <resource> --help`) and not fully enumerable offline; using one verified code path for all ~15 resources is more correct and testable than guessing at operation names per resource.
- Requires the Stripe CLI on PATH; stripe-axi itself has no runtime dependency on the `stripe` npm SDK.

## Development

```sh
npm install
npm run build
node bin/stripe-axi.js          # home view (live content, AXI principle 8)
npm test                        # offline test suite (no Stripe CLI or key required)
npm run skill:gen               # regenerate skills/stripe-axi/SKILL.md (commit it)
```

The offline test suite covers request/argument construction, Idempotency-Key derivation, TOON output, key/mode parsing, and — most importantly — the safety gate itself: it runs the real built binary against a stub `stripe` script placed first on `PATH`, which logs every invocation, and proves from that log that each gated command (a) never invokes the Stripe CLI without `--confirm`, (b) refuses `--confirm` alone in LIVE mode, and (c) does reach real execution once fully acknowledged (`--confirm --i-understand-this-is-live`). No network, no real Stripe CLI, and no key is needed, and the result is the same whether or not you have the Stripe CLI installed.

For a live smoke test once you have a Stripe CLI and a **TEST** key installed:

```sh
export STRIPE_API_KEY=sk_test_...
stripe-axi balance
stripe-axi customer add --email test@example.com --confirm
stripe-axi refund <a-real-test-charge-id> --amount 100 --confirm
```

Check AXI compliance any time:

```sh
npx -y axi-axi validate "node bin/stripe-axi.js" --dir .
npx -y axi-axi checklist --phase implement
```

## Agent integration

Two complementary paths (both optional):

- **Session hook** (ambient, live state): `npx -y axi-axi setup hooks --dir .` installs a SessionStart hook that loads the home view at session start.
- **Skill** (on-demand, broader support): [`skills/stripe-axi/SKILL.md`](skills/stripe-axi/SKILL.md) is generated from the same content as the home view and states the safety model explicitly for an agent reader. CI runs `npm run skill:check` so it cannot go stale.

## Structure

- `src/cli/`, `src/output/` — shared AXI plumbing (strict flag parsing, TOON output, structured errors), from the axi-axi scaffold.
- `src/stripe/` — key/mode detection (`config.ts`), the Stripe CLI process wrapper (`cli.ts`), error mapping (`errors.ts`), money formatting (`format.ts`).
- `src/safety/` — the gate every mutating command routes through (`gate.ts`) and deterministic Idempotency-Key derivation (`idempotency.ts`).
- `src/commands/` — one file per Stripe resource, built on the shared list/detail/gated-write builders in `factory.ts`.
- `src/skill/content.ts` — single source for the no-key home view and the generated SKILL.md.

## License

[MIT](LICENSE)
