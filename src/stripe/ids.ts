// Positional resource IDs are interpolated into API paths (/v1/charges/<id>),
// so an ID carrying '/', '?' or '#' would re-target the request at an endpoint
// the command name does not describe. Every command that embeds a positional
// ID validates it here first.

import { UsageError } from "../output/errors.js";

const RESOURCE_ID = /^[A-Za-z0-9_.-]+$/;

export function assertResourceId(id: string, argName = "id"): string {
  if (!RESOURCE_ID.test(id)) {
    throw new UsageError(
      `invalid ${argName} ${JSON.stringify(id)}`,
      "a Stripe resource ID contains only letters, digits, '_', '.' and '-' - copy it from a list command or the dashboard",
    );
  }
  return id;
}
