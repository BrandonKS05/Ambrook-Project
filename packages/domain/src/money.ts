/** Formats integer cents as US dollars: 123456 → "$1,234.56". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  const dollars = Math.floor(abs / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${sign}$${dollars}.${String(abs % 100).padStart(2, "0")}`;
}

/**
 * Parses human money input ("$1,234.56", "1234.5", "12") to integer cents.
 * Returns null for anything that isn't a plain positive dollar amount.
 */
export function parseMoney(text: string): number | null {
  const cleaned = text.trim().replace(/^\$/, "").replaceAll(",", "");
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(cleaned);
  if (!match) return null;
  const dollars = Number(match[1]);
  const centsPart = match[2] ?? "";
  const cents = Number(centsPart.padEnd(2, "0") || "0");
  return dollars * 100 + cents;
}
