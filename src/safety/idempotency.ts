// Deterministic Idempotency-Key derivation: the same command + arguments
// always produce the same key, so an accidental retry of an identical
// --confirm invocation can't double-charge. Stripe keys are capped at 255
// chars and expire after ~24h (docs.stripe.com/api/idempotent_requests).

import { createHash } from "node:crypto";

export function deriveIdempotencyKey(operation: string, params: Record<string, unknown>): string {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${String(params[k])}`)
    .join("&");
  const digest = createHash("sha256").update(`${operation}\n${sorted}`).digest("hex").slice(0, 40);
  return `stripe-axi_${operation}_${digest}`;
}
