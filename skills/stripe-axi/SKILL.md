---
name: stripe-axi
description: "AXI-compliant CLI for Stripe — inspect payments, customers, subscriptions, invoices, and balance; move money only under explicit, gated confirmation. Wraps the official Stripe CLI."
---

# stripe-axi

AXI-compliant CLI for Stripe — inspect payments, customers, subscriptions, invoices, and balance; move money only under explicit, gated confirmation. Wraps the official Stripe CLI. (built against AXI spec axi/1.0-2026-07). Run the commands below with npx — no install needed. Requires the official Stripe CLI ('stripe') on PATH and a STRIPE_API_KEY environment variable.

## Safety model (read this first)

- **Read-only by default.** Every list/detail/balance/events command only reads data.
- **Every mutating command dry-runs by default.** It prints the exact `stripe` command it would run and does nothing else. Add `--confirm` to actually execute it.
- **LIVE mode needs a second acknowledgement.** If the active key is `sk_live_`/`rk_live_`, `--confirm` alone is refused — add `--i-understand-this-is-live` too. `--confirm` alone can never move real money in live mode.
- **Idempotency-Key on every mutating POST**, derived deterministically from the command, the exact request it makes and its parameters, so re-running an identical `--confirm` can't double-charge. The two DELETE writes (`customer rm`, immediate `subscription cancel`) send none: DELETE is idempotent by definition.
- Refunds and payouts (money leaving the account) are the most guarded commands.

```
commands[35]{command,summary}:
  balance,Available and pending balance by currency
  charges,List charges
  charge <id>,Show a single charge
  charge capture <id>,GATED: capture an authorized charge
  payments,List payment intents
  payment <id>,Show a single payment intent
  payment capture <id>,GATED: capture a payment intent
  payment cancel <id>,GATED: cancel a payment intent
  customers,List customers
  customer <id>,Show a single customer
  customer add,GATED: create a customer
  customer rm <id>,GATED: delete a customer
  subscriptions,List subscriptions
  subscription <id>,Show a single subscription
  subscription cancel <id>,GATED: cancel a subscription
  invoices,List invoices
  invoice <id>,Show a single invoice
  invoice void <id>,GATED: void an invoice
  refunds,List refunds
  refund <id>,"GATED, MOVES MONEY: refund a charge or payment intent"
  payouts,List payouts
  payout <id>,Show a single payout
  payout create,"GATED, MOVES MONEY (most guarded): create a payout"
  products,List products
  product <id>,Show a single product
  product update <id>,GATED: update a product
  prices,List prices
  price <id>,Show a single price
  price update <id>,GATED: update a price
  events,List recent events (debugging)
  event <id>,Show a single event
  disputes,List disputes
  dispute <id>,Show a single dispute
  checkout sessions,List Checkout Sessions
  payment-links,List payment links
help[3]:
  export STRIPE_API_KEY=sk_test_... (get one at https://dashboard.stripe.com/apikeys)
  npx -y stripe-axi balance
  npx -y stripe-axi --help
```

Every command supports `--help`. Exit codes: 0 success/no-op, 1 error, 2 usage error. All output is TOON on stdout.
