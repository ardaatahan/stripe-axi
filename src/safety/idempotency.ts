// Deterministic Idempotency-Key derivation: the same command + target +
// arguments always produce the same key, so an accidental retry of an
// identical --confirm invocation can't double-charge. The API method and
// path are part of the input because several operations carry their target
// resource only in the path (e.g. POST /v1/invoices/in_A/void) with empty or
// constant params - keying on operation+params alone would make two
// different resources collide on one key. Params are serialized with the same
// flattenParams() bracket encoding the request body itself is built from, so
// nested values (line_items, metadata) are fully captured rather than
// collapsing to "[object Object]". Stripe keys are capped at 255 chars and
// expire after ~24h (docs.stripe.com/api/idempotent_requests).

import { createHash } from "node:crypto";
import { flattenParams } from "../stripe/cli.js";

export interface IdempotencyInput {
  /** Stable operation name, e.g. "invoice.void". */
  operation: string;
  /** HTTP method of the request the key will be sent with. */
  method: string;
  /** Full API path, including any resource ID. */
  path: string;
  params?: Record<string, unknown>;
}

export function deriveIdempotencyKey(input: IdempotencyInput): string {
  const sorted = flattenParams(input.params ?? {}).sort().join("&");
  const digest = createHash("sha256")
    .update(`${input.operation}\n${input.method} ${input.path}\n${sorted}`)
    .digest("hex")
    .slice(0, 40);
  return `stripe-axi_${input.operation}_${digest}`;
}
