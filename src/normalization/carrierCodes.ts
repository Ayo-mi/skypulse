/**
 * Carrier code normalization.
 * The DOT T-100 data uses DOT/BTS carrier codes which may differ from IATA.
 * This module maps known DOT codes to IATA codes.
 */

/** Map from DOT/BTS numeric or alpha codes → IATA 2-letter code. */
const DOT_TO_IATA: Record<string, string> = {
  // Major US carriers
  '19930': 'AA', // American Airlines
  '19977': 'DL', // Delta Air Lines
  '21171': 'WN', // Southwest
  '20436': 'UA', // United
  '20409': 'B6', // JetBlue
  '19386': 'AS', // Alaska
  '20416': 'NK', // Spirit
  '22129': 'F9', // Frontier
  '20398': 'G4', // Allegiant
  '19690': 'HA', // Hawaiian
};

const IATA_PATTERN = /^[A-Z0-9]{2}$/;

/** Normalize a carrier code to IATA 2-letter string, or return original if unknown. */
export function normalizeCarrierCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  // Already looks like IATA
  if (IATA_PATTERN.test(trimmed)) return trimmed;
  // Try DOT mapping
  return DOT_TO_IATA[trimmed] ?? trimmed;
}
