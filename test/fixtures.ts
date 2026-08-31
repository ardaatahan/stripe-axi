// Canned Stripe response bodies matching the documented shapes
// (docs.stripe.com/api), used to mock the Stripe CLI's stdout in tests.

export const FIXTURE_CHARGE = {
  id: "ch_1OKcnt2eZvKYlo2C99k9lfXl",
  object: "charge",
  amount: 1000,
  currency: "usd",
  captured: true,
  customer: "cus_NWSaVkvdacCUi4",
  payment_intent: "pi_1Gt0RG2eZvKYlo2CtxkQK2rm",
  created: 1701937169,
  description: "Test charge",
  refunded: false,
  receipt_url: "https://pay.stripe.com/receipts/x",
  status: "succeeded",
};

export const FIXTURE_REFUND = {
  id: "re_1MoBy5LkdIwHu7ixZhnattbh",
  object: "refund",
  amount: 500,
  currency: "usd",
  charge: "ch_1OKcnt2eZvKYlo2C99k9lfXl",
  status: "succeeded",
  reason: null,
  created: 1701937169,
};

export const FIXTURE_PAYOUT = {
  id: "po_1MoBy5LkdIwHu7ixZhnattbh",
  object: "payout",
  amount: 10000,
  currency: "usd",
  status: "pending",
  method: "standard",
  arrival_date: 1701937169,
  created: 1701937169,
};

export const FIXTURE_CUSTOMER = {
  id: "cus_9s6XKzkNRiz8i3",
  object: "customer",
  email: "billing@example.com",
  name: "Jenny Rosen",
  description: "My First Test Customer",
  balance: 0,
  delinquent: false,
  created: 1680893993,
};

export const FIXTURE_CUSTOMER_DELETED = {
  id: "cus_9s6XKzkNRiz8i3",
  object: "customer",
  deleted: true,
};

export const FIXTURE_SUBSCRIPTION = {
  id: "sub_1MlPf9LkdIwHu7ixB6VIYRyX",
  object: "subscription",
  customer: "cus_NWSaVkvdacCUi4",
  status: "canceled",
  cancel_at_period_end: false,
  canceled_at: 1678768842,
  created: 1678768838,
  latest_invoice: "in_1MlPf9LkdIwHu7ixEo6hdgCw",
};

export const FIXTURE_INVOICE = {
  id: "in_1MlPf9LkdIwHu7ixEo6hdgCw",
  object: "invoice",
  customer: "cus_NWSaVkvdacCUi4",
  status: "void",
  amount_due: 1099,
  amount_paid: 0,
  currency: "usd",
  number: "ABCD-0001",
  hosted_invoice_url: "https://invoice.stripe.com/i/x",
  created: 1678768838,
};

export const FIXTURE_BALANCE = {
  object: "balance",
  available: [{ amount: 10000, currency: "usd", source_types: { card: 10000 } }],
  pending: [{ amount: 500, currency: "usd", source_types: { card: 500 } }],
};

export const FIXTURE_LIST = (data: unknown[], hasMore = false) => ({
  object: "list",
  url: "/v1/charges",
  has_more: hasMore,
  data,
});

export const FIXTURE_ERROR_INVALID_REQUEST = {
  error: {
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such charge: 'ch_bad'",
    param: "id",
  },
};

export const FIXTURE_ERROR_CARD = {
  error: {
    type: "card_error",
    code: "card_declined",
    message: "Your card was declined.",
    decline_code: "generic_decline",
  },
};
