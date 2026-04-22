/**
 * Airport code canonicalization helpers.
 * Normalizes IATA codes to uppercase 3-letter strings.
 * Returns null for unknown / invalid codes so callers can filter them out.
 */

const IATA_PATTERN = /^[A-Z]{3}$/;

/** Normalize to uppercase 3-letter IATA code, or null if invalid. */
export function normalizeIata(raw: string): string | null {
  const code = raw.trim().toUpperCase();
  return IATA_PATTERN.test(code) ? code : null;
}

/** Parse a city-pair string like "JFK-LAX" into [origin, destination]. */
export function parseCityPair(pair: string): [string, string] | null {
  const parts = pair.split('-');
  if (parts.length !== 2) return null;
  const origin = normalizeIata(parts[0]);
  const dest = normalizeIata(parts[1]);
  if (!origin || !dest) return null;
  return [origin, dest];
}
