import { describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "../src/safety/idempotency.js";

const REFUND = { operation: "refund.create", method: "POST", path: "/v1/refunds" };

describe("deriveIdempotencyKey", () => {
  it("is deterministic for the same operation, target and params", () => {
    const a = deriveIdempotencyKey({ ...REFUND, params: { charge: "ch_1", amount: "500" } });
    const b = deriveIdempotencyKey({ ...REFUND, params: { charge: "ch_1", amount: "500" } });
    expect(a).toBe(b);
  });

  it("is order-independent across param key order", () => {
    const a = deriveIdempotencyKey({ ...REFUND, params: { charge: "ch_1", amount: "500" } });
    const b = deriveIdempotencyKey({ ...REFUND, params: { amount: "500", charge: "ch_1" } });
    expect(a).toBe(b);
  });

  it("differs when parameters differ", () => {
    const a = deriveIdempotencyKey({ ...REFUND, params: { charge: "ch_1", amount: "500" } });
    const b = deriveIdempotencyKey({ ...REFUND, params: { charge: "ch_1", amount: "600" } });
    expect(a).not.toBe(b);
  });

  it("differs across operations with identical params", () => {
    const a = deriveIdempotencyKey({ operation: "charge.capture", method: "POST", path: "/v1/charges/ch_1/capture" });
    const b = deriveIdempotencyKey({ operation: "payment_intent.capture", method: "POST", path: "/v1/payment_intents/pi_1/capture" });
    expect(a).not.toBe(b);
  });

  // The operations that carry their target only in the path — void, capture,
  // cancel, delete — have empty or constant params, so keying on
  // operation+params alone would send one key for two different resources and
  // let Stripe replay the first response for the second request.
  it("differs across resources when the operation and params are identical", () => {
    const a = deriveIdempotencyKey({ operation: "invoice.void", method: "POST", path: "/v1/invoices/in_A/void" });
    const b = deriveIdempotencyKey({ operation: "invoice.void", method: "POST", path: "/v1/invoices/in_B/void" });
    expect(a).not.toBe(b);
  });

  it("differs across methods on the same path", () => {
    const a = deriveIdempotencyKey({ operation: "customer.delete", method: "DELETE", path: "/v1/customers/cus_1" });
    const b = deriveIdempotencyKey({ operation: "customer.delete", method: "POST", path: "/v1/customers/cus_1" });
    expect(a).not.toBe(b);
  });

  // line_items is the only thing that differs between two `checkout create` or
  // `payment-link create` invocations; a shallow String(value) renders both as
  // "[object Object]" and hands two different requests the same key.
  it("differs across nested param values", () => {
    const link = { operation: "payment_link.create", method: "POST", path: "/v1/payment_links" };
    const a = deriveIdempotencyKey({ ...link, params: { line_items: [{ price: "price_A", quantity: "1" }] } });
    const b = deriveIdempotencyKey({ ...link, params: { line_items: [{ price: "price_B", quantity: "1" }] } });
    expect(a).not.toBe(b);
  });

  it("differs across nested param values nested two levels deep", () => {
    const session = { operation: "checkout_session.create", method: "POST", path: "/v1/checkout/sessions" };
    const a = deriveIdempotencyKey({ ...session, params: { metadata: { order: { id: "1" } } } });
    const b = deriveIdempotencyKey({ ...session, params: { metadata: { order: { id: "2" } } } });
    expect(a).not.toBe(b);
  });

  it("stays within Stripe's 255-character idempotency key limit", () => {
    const key = deriveIdempotencyKey({
      operation: "payout.create",
      method: "POST",
      path: "/v1/payouts",
      params: { amount: "10000", currency: "usd" },
    });
    expect(key.length).toBeLessThanOrEqual(255);
  });
});
