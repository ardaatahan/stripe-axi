// Money formatting. Stripe amounts are integers in the currency's smallest
// unit: 1/100 for most currencies, 1/1 for the documented zero-decimal set,
// and 1/1000 for the three-decimal set (docs.stripe.com/currencies).

const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

const THREE_DECIMAL = new Set(["bhd", "jod", "kwd", "omr", "tnd"]);

export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return "";
  const cur = currency.toLowerCase();
  if (ZERO_DECIMAL.has(cur)) return `${amount} ${cur}`;
  if (THREE_DECIMAL.has(cur)) return `${(amount / 1000).toFixed(3)} ${cur}`;
  return `${(amount / 100).toFixed(2)} ${cur}`;
}

export function formatUnixTime(seconds: number | null | undefined): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString();
}
