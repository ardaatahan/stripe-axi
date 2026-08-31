// Money formatting. Stripe amounts are integers in the currency's smallest
// unit (cents) except for a documented set of zero-decimal currencies.

const ZERO_DECIMAL = new Set([
  "bif", "clp", "djf", "gnf", "jpy", "kmf", "krw", "mga", "pyg",
  "rwf", "ugx", "vnd", "vuv", "xaf", "xof", "xpf",
]);

export function formatAmount(amount: number | null | undefined, currency: string | null | undefined): string {
  if (amount === null || amount === undefined || !currency) return "";
  const cur = currency.toLowerCase();
  if (ZERO_DECIMAL.has(cur)) return `${amount} ${cur}`;
  return `${(amount / 100).toFixed(2)} ${cur}`;
}

export function formatUnixTime(seconds: number | null | undefined): string {
  if (!seconds) return "";
  return new Date(seconds * 1000).toISOString();
}
