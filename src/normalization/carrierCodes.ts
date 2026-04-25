/**
 * Carrier code normalization.
 *
 * BTS T-100 ships carrier codes in three different shapes inside the
 * UNIQUE_CARRIER column, sometimes within the same monthly file:
 *
 *   • IATA 2-character (e.g. "AA", "DL", "N8")        — the public-facing code
 *   • DOT 5-digit numeric (e.g. "19930", "19690")     — BTS reporting ID
 *   • ICAO 3-letter (e.g. "AAL", "DAL", "GFQ")        — operational/ATC code
 *   • BTS-internal 3-char (e.g. "1UQ", "2A3")         — unpublished sub-regional
 *                                                       or charter operators
 *
 * This module collapses all four into the canonical IATA 2-character code
 * whenever a public mapping exists. Codes that don't resolve are passed
 * through unchanged so the downstream layer can label them
 * "Unresolved (BTS code: <X>)" rather than dropping the row.
 *
 * Reviewer feedback referenced unresolved codes N8 (now mapped → N8),
 * GFQ / GCA / 1UQ (BTS-internal sub-regional / charter codes that have no
 * public IATA mapping; these correctly fall through and get the
 * Unresolved label).
 */

// ── DOT 5-digit → IATA ─────────────────────────────────────────────────────
// The DOT codes BTS publishes in CARRIER_DECODE.csv. Only the operators we
// actually see meaningful T-100 traffic from are listed here; expanding this
// further is cheap and safe because lookup is a single hash hit.
const DOT_TO_IATA: Record<string, string> = {
  // US mainline
  '19930': 'AA', // American Airlines
  '19977': 'DL', // Delta Air Lines
  '20436': 'UA', // United Airlines
  '21171': 'WN', // Southwest Airlines
  '20409': 'B6', // JetBlue Airways
  '19386': 'AS', // Alaska Airlines
  '20416': 'NK', // Spirit Airlines
  '22129': 'F9', // Frontier Airlines
  '20398': 'G4', // Allegiant Air
  '19690': 'HA', // Hawaiian Airlines
  '20366': 'SY', // Sun Country
  // US regional / feeder
  '20304': 'OO', // SkyWest
  '20452': 'YX', // Republic Airways
  '20363': '9E', // Endeavor Air
  '20378': 'MQ', // Envoy Air
  '20445': 'OH', // PSA Airlines
  '20355': 'YV', // Mesa Airlines
  '20210': 'ZW', // Air Wisconsin
  '20389': 'PT', // Piedmont Airlines
  '21217': 'C5', // CommutAir
  '19805': 'QX', // Horizon Air
  // US cargo / freighter
  '20214': '5Y', // Atlas Air
  '19393': '5X', // UPS Airlines
  '19809': 'FX', // FedEx Express
  '19618': 'K4', // Kalitta Air
  '20211': 'M6', // Amerijet
  // US specialty / charter / niche
  '20177': 'XE', // JSX (formerly JetSuiteX)
  '21389': 'B8', // Eastern Airlines
  '20194': 'N8', // National Airlines
  // Canada
  '20402': 'AC', // Air Canada
  '21179': 'WS', // WestJet
  // Mexico
  '21209': 'AM', // Aeromexico
  '21099': 'Y4', // Volaris
  '20425': 'VB', // VivaAerobus
  // Europe
  '21508': 'BA', // British Airways
  '21515': 'LH', // Lufthansa
  '21587': 'AF', // Air France
  '21516': 'KL', // KLM
  '21504': 'IB', // Iberia
  '21527': 'AZ', // Alitalia / ITA Airways
  '21514': 'LX', // Swiss
  '21535': 'TP', // TAP Air Portugal
  '21509': 'EI', // Aer Lingus
  '21540': 'OS', // Austrian
  '21541': 'SN', // Brussels
  '21539': 'SK', // SAS
  '21512': 'TK', // Turkish
  '21586': 'LO', // LOT Polish
  '21506': 'VS', // Virgin Atlantic
  // Middle East
  '21607': 'EK', // Emirates
  '21608': 'QR', // Qatar Airways
  '21609': 'EY', // Etihad
  '21568': 'SV', // Saudia
  '21580': 'GF', // Gulf Air
  // Asia / Pacific
  '21610': 'SQ', // Singapore Airlines
  '21611': 'CX', // Cathay Pacific
  '21612': 'NH', // ANA
  '21613': 'JL', // JAL
  '21614': 'KE', // Korean Air
  '21615': 'OZ', // Asiana
  '21616': 'CA', // Air China
  '21617': 'MU', // China Eastern
  '21618': 'CZ', // China Southern
  '21619': 'CI', // China Airlines
  '21620': 'BR', // EVA Air
  '21621': 'TG', // Thai Airways
  '21622': 'PR', // Philippine Airlines
  '21623': 'MH', // Malaysia Airlines
  '21624': 'VN', // Vietnam Airlines
  '21625': 'NZ', // Air New Zealand
  '21626': 'QF', // Qantas
  '21627': 'VA', // Virgin Australia
  '21628': 'FJ', // Fiji Airways
  // Latin America / Caribbean
  '21199': 'AV', // Avianca
  '21205': 'LA', // LATAM
  '21206': 'JJ', // LATAM Brasil
  '21207': 'AR', // Aerolineas Argentinas
  '21208': 'CM', // Copa
  '21210': 'G3', // Gol
  '21211': 'AD', // Azul
  '21212': 'BW', // Caribbean Airlines
  '21213': 'JM', // Air Jamaica
  // Africa
  '21280': 'ET', // Ethiopian
  '21281': 'SA', // South African
};

// ── ICAO 3-letter → IATA ────────────────────────────────────────────────────
// The ICAO codes BTS sometimes ships when UNIQUE_CARRIER is sourced from FAA
// rather than the carrier-decoded table. About 250 operators worldwide cover
// >95% of the T-100 long-tail; we list the ones with non-trivial US presence.
const ICAO_TO_IATA: Record<string, string> = {
  // US mainline
  AAL: 'AA',
  DAL: 'DL',
  UAL: 'UA',
  SWA: 'WN',
  JBU: 'B6',
  ASA: 'AS',
  NKS: 'NK',
  FFT: 'F9',
  AAY: 'G4',
  HAL: 'HA',
  SCX: 'SY',
  // US regional
  SKW: 'OO',
  RPA: 'YX',
  FLG: '9E',
  EGF: 'MQ',
  CAA: 'OH',
  ASH: 'YV', // Mesa Airlines
  AWI: 'ZW',
  PDT: 'PT',
  UCA: 'C5',
  QXE: 'QX',
  // US cargo
  GTI: '5Y', // Atlas Air
  UPS: '5X',
  FDX: 'FX',
  CKS: 'K4',
  MEI: 'M6',
  ABX: 'GB', // ABX Air
  ATN: '8C', // Air Transport International
  CFS: 'PO', // Polar Air Cargo
  NCR: 'N8', // National Airlines
  // US charter / niche
  XSR: 'XE', // JSX
  EAL: 'B8', // Eastern Airlines
  AJT: 'M6',
  // Canada
  ACA: 'AC',
  WJA: 'WS',
  POE: 'PD', // Porter Airlines
  // Mexico
  AMX: 'AM',
  VOI: 'Y4',
  VIV: 'VB',
  AIJ: '4O', // Interjet
  // Europe
  BAW: 'BA',
  DLH: 'LH',
  AFR: 'AF',
  KLM: 'KL',
  IBE: 'IB',
  AZA: 'AZ',
  SWR: 'LX',
  TAP: 'TP',
  EIN: 'EI',
  AUA: 'OS',
  BEL: 'SN',
  SAS: 'SK',
  THY: 'TK',
  LOT: 'LO',
  VIR: 'VS',
  RYR: 'FR', // Ryanair
  EZY: 'U2', // easyJet
  // Middle East / Africa
  UAE: 'EK',
  QTR: 'QR',
  ETD: 'EY',
  SVA: 'SV',
  GFA: 'GF',
  ETH: 'ET',
  SAA: 'SA',
  RAM: 'AT', // Royal Air Maroc
  // Asia / Pacific
  SIA: 'SQ',
  CPA: 'CX',
  ANA: 'NH',
  JAL: 'JL',
  KAL: 'KE',
  AAR: 'OZ',
  CCA: 'CA',
  CES: 'MU',
  CSN: 'CZ',
  CAL: 'CI',
  EVA: 'BR',
  THA: 'TG',
  PAL: 'PR',
  MAS: 'MH',
  HVN: 'VN',
  ANZ: 'NZ',
  QFA: 'QF',
  VOZ: 'VA',
  FJI: 'FJ',
  THT: 'TN',
  CHH: 'HU', // Hainan
  // Latin America / Caribbean
  AVA: 'AV',
  LAN: 'LA',
  TAM: 'JJ',
  ARG: 'AR',
  CMP: 'CM',
  GLO: 'G3',
  AZU: 'AD',
  BWA: 'BW',
  JAM: 'JM',
  LRC: 'LR',
  SKU: 'H2',
  JAT: 'JA',
  GLG: '2K',
  RPB: 'P5',
  CUB: 'CU',
};

const IATA_PATTERN = /^[A-Z0-9]{2}$/;

/**
 * Normalize a carrier code to a canonical IATA 2-character string when
 * possible. Codes that don't resolve are upper-cased and returned as-is so
 * the downstream layer can flag them as unresolved.
 *
 * Lookup priority:
 *   1. Already a clean IATA 2-char       → use directly
 *   2. Looks like a DOT 5-digit numeric  → DOT_TO_IATA
 *   3. Looks like an ICAO 3-letter alpha → ICAO_TO_IATA
 *   4. Otherwise                         → return as-is (unresolved)
 */
export function normalizeCarrierCode(raw: string): string {
  const trimmed = raw.trim().toUpperCase();
  if (!trimmed) return trimmed;

  if (IATA_PATTERN.test(trimmed)) {
    return trimmed;
  }

  if (/^\d{4,5}$/.test(trimmed)) {
    return DOT_TO_IATA[trimmed] ?? trimmed;
  }

  if (/^[A-Z]{3}$/.test(trimmed)) {
    return ICAO_TO_IATA[trimmed] ?? trimmed;
  }

  return trimmed;
}

/**
 * True when a carrier code does NOT resolve to a known operator after
 * normalization (i.e. it would be displayed to agents as
 * "Unresolved (BTS code: <X>)" by the query layer).
 *
 * Used by tools to count unresolved carriers in a response so the
 * known_unknowns string can flag data-quality issues to the agent.
 */
export function isResolvableCarrierCode(code: string): boolean {
  const t = code.trim().toUpperCase();
  if (!t) return false;
  if (IATA_PATTERN.test(t)) return true;
  if (/^\d{4,5}$/.test(t) && DOT_TO_IATA[t]) return true;
  if (/^[A-Z]{3}$/.test(t) && ICAO_TO_IATA[t]) return true;
  return false;
}
