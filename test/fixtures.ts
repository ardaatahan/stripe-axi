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

export const FIXTURE_ERROR_INVALID_REQUEST = {
  error: {
    type: "invalid_request_error",
    code: "resource_missing",
    message: "No such charge: 'ch_bad'",
    param: "id",
  },
};
