import { describe, expect, it } from "vitest";
import { deriveIdempotencyKey } from "../src/safety/idempotency.js";

describe("deriveIdempotencyKey", () => {
  it("is deterministic for the same operation and params", () => {
    const a = deriveIdempotencyKey("refund.create", { charge: "ch_1", amount: "500" });
    const b = deriveIdempotencyKey("refund.create", { charge: "ch_1", amount: "500" });
    expect(a).toBe(b);
  });

  it("is order-independent across param key order", () => {
    const a = deriveIdempotencyKey("refund.create", { charge: "ch_1", amount: "500" });
    const b = deriveIdempotencyKey("refund.create", { amount: "500", charge: "ch_1" });
    expect(a).toBe(b);
  });

  it("differs when parameters differ", () => {
    const a = deriveIdempotencyKey("refund.create", { charge: "ch_1", amount: "500" });
    const b = deriveIdempotencyKey("refund.create", { charge: "ch_1", amount: "600" });
    expect(a).not.toBe(b);
  });

  it("differs across operations with identical params", () => {
    const a = deriveIdempotencyKey("charge.capture", { id: "ch_1" });
    const b = deriveIdempotencyKey("payment_intent.capture", { id: "ch_1" });
    expect(a).not.toBe(b);
  });

  it("stays within Stripe's 255-character idempotency key limit", () => {
    const key = deriveIdempotencyKey("payout.create", { amount: "10000", currency: "usd" });
    expect(key.length).toBeLessThanOrEqual(255);
  });
});
