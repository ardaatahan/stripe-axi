// Maps Stripe's error JSON (identical shape whether it reaches us via the
// official CLI's stdout or a raw HTTP response) to a structured AxiError.

import { AxiError } from "../output/errors.js";

export interface StripeErrorBody {
  error?: {
    type?: string;
    code?: string;
    message?: string;
    param?: string;
    decline_code?: string;
    doc_url?: string;
  };
}

function suggestionForError(type: string, code: string | undefined, param: string | undefined): string {
  switch (type) {
    case "invalid_request_error":
      if (code === "resource_missing") {
        return "check the ID is correct and exists in the active mode (TEST vs LIVE)";
      }
      return param ? `check the '${param}' value and retry` : "check the request parameters against '--help' and retry";
    case "idempotency_error":
      return "a prior request reused this Idempotency-Key with different parameters - retry with unchanged parameters or wait ~24h for it to expire";
    case "card_error":
      return "the card was declined by Stripe or the issuing bank - this is not a bug in stripe-axi";
    case "api_error":
      return "this is a Stripe-side error - retry, and check https://status.stripe.com if it persists";
    case "authentication_error":
      return "check STRIPE_API_KEY is a valid, unrevoked key from https://dashboard.stripe.com/apikeys";
    case "permission_error":
      return "the API key lacks permission for this - restricted keys need this resource enabled at https://dashboard.stripe.com/apikeys";
    case "rate_limit_error":
      return "you're being rate limited - wait a moment and retry";
    default:
      return "re-run with '--help' to check parameters";
  }
}

export function stripeErrorToAxiError(body: StripeErrorBody): AxiError {
  const err = body.error ?? {};
  const type = err.type ?? "api_error";
  const label = err.code ? `${type}/${err.code}` : type;
  const message = err.message ?? "Stripe API error";
  const suggestion = suggestionForError(type, err.code, err.param);
  const axiErr = new AxiError(`${label}: ${message}`, suggestion);
  axiErr.exitCode = 1;
  return axiErr;
}
