/**
 * Aircraft type normalization and seat inference.
 * Maps IATA aircraft type codes (and DOT BTS aircraft type codes) to
 * canonical IATA codes with typical seat counts.
 */

export interface AircraftSeatReference {
  iataCode: string;
  totalSeats: number;
  economySeats: number;
  category: 'narrowbody' | 'widebody' | 'regional_jet' | 'turboprop' | 'other';
}

/**
 * Master seat reference table.
 * Covers the most common aircraft types in US domestic and US-international
 * service.  All seat counts are "typical" for a standard 2-class configuration.
 */
export const SEAT_REFERENCE: Record<string, AircraftSeatReference> = {
  // ── Boeing 737 family ────────────────────────────────────────────────────────
  B737: { iataCode: 'B737', totalSeats: 149, economySeats: 128, category: 'narrowbody' },
  B738: { iataCode: 'B738', totalSeats: 189, economySeats: 162, category: 'narrowbody' },
  B739: { iataCode: 'B739', totalSeats: 189, economySeats: 165, category: 'narrowbody' },
  // Boeing 737 MAX family
  B38M: { iataCode: 'B38M', totalSeats: 178, economySeats: 162, category: 'narrowbody' },
  B39M: { iataCode: 'B39M', totalSeats: 193, economySeats: 165, category: 'narrowbody' },
  B3XM: { iataCode: 'B3XM', totalSeats: 204, economySeats: 188, category: 'narrowbody' },
  // aliases
  '737': { iataCode: 'B737', totalSeats: 149, economySeats: 128, category: 'narrowbody' },
  '738': { iataCode: 'B738', totalSeats: 189, economySeats: 162, category: 'narrowbody' },
  '73H': { iataCode: 'B738', totalSeats: 189, economySeats: 162, category: 'narrowbody' },
  '7M8': { iataCode: 'B38M', totalSeats: 178, economySeats: 162, category: 'narrowbody' },

  // ── Airbus A320 family ───────────────────────────────────────────────────────
  A319: { iataCode: 'A319', totalSeats: 144, economySeats: 128, category: 'narrowbody' },
  A320: { iataCode: 'A320', totalSeats: 180, economySeats: 150, category: 'narrowbody' },
  A321: { iataCode: 'A321', totalSeats: 220, economySeats: 185, category: 'narrowbody' },
  // A320neo family
  A19N: { iataCode: 'A19N', totalSeats: 144, economySeats: 128, category: 'narrowbody' },
  A20N: { iataCode: 'A20N', totalSeats: 180, economySeats: 150, category: 'narrowbody' },
  A21N: { iataCode: 'A21N', totalSeats: 220, economySeats: 182, category: 'narrowbody' },
  // aliases
  '319': { iataCode: 'A319', totalSeats: 144, economySeats: 128, category: 'narrowbody' },
  '320': { iataCode: 'A320', totalSeats: 180, economySeats: 150, category: 'narrowbody' },
  '321': { iataCode: 'A321', totalSeats: 220, economySeats: 185, category: 'narrowbody' },
  A321neo: { iataCode: 'A21N', totalSeats: 220, economySeats: 182, category: 'narrowbody' },
  B737MAX8: { iataCode: 'B38M', totalSeats: 178, economySeats: 162, category: 'narrowbody' },

  // ── Boeing widebody ──────────────────────────────────────────────────────────
  B752: { iataCode: 'B752', totalSeats: 200, economySeats: 176, category: 'narrowbody' },
  B753: { iataCode: 'B753', totalSeats: 228, economySeats: 196, category: 'narrowbody' },
  B762: { iataCode: 'B762', totalSeats: 181, economySeats: 158, category: 'widebody' },
  B763: { iataCode: 'B763', totalSeats: 218, economySeats: 198, category: 'widebody' },
  B764: { iataCode: 'B764', totalSeats: 245, economySeats: 218, category: 'widebody' },
  B772: { iataCode: 'B772', totalSeats: 400, economySeats: 360, category: 'widebody' },
  B773: { iataCode: 'B773', totalSeats: 396, economySeats: 360, category: 'widebody' },
  B77W: { iataCode: 'B77W', totalSeats: 396, economySeats: 365, category: 'widebody' },
  B788: { iataCode: 'B788', totalSeats: 242, economySeats: 210, category: 'widebody' },
  B789: { iataCode: 'B789', totalSeats: 296, economySeats: 252, category: 'widebody' },
  B78X: { iataCode: 'B78X', totalSeats: 330, economySeats: 296, category: 'widebody' },

  // ── Airbus widebody ──────────────────────────────────────────────────────────
  A332: { iataCode: 'A332', totalSeats: 247, economySeats: 222, category: 'widebody' },
  A333: { iataCode: 'A333', totalSeats: 277, economySeats: 253, category: 'widebody' },
  A359: { iataCode: 'A359', totalSeats: 325, economySeats: 300, category: 'widebody' },
  A35K: { iataCode: 'A35K', totalSeats: 360, economySeats: 330, category: 'widebody' },
  A388: { iataCode: 'A388', totalSeats: 555, economySeats: 471, category: 'widebody' },
  A380: { iataCode: 'A388', totalSeats: 555, economySeats: 471, category: 'widebody' },

  // ── Regional jets ────────────────────────────────────────────────────────────
  E170: { iataCode: 'E170', totalSeats: 72, economySeats: 66, category: 'regional_jet' },
  E175: { iataCode: 'E175', totalSeats: 78, economySeats: 70, category: 'regional_jet' },
  E190: { iataCode: 'E190', totalSeats: 106, economySeats: 94, category: 'regional_jet' },
  E195: { iataCode: 'E195', totalSeats: 118, economySeats: 106, category: 'regional_jet' },
  E75L: { iataCode: 'E75L', totalSeats: 76, economySeats: 68, category: 'regional_jet' },
  E7W:  { iataCode: 'E7W',  totalSeats: 80, economySeats: 72, category: 'regional_jet' },
  CRJ2: { iataCode: 'CRJ2', totalSeats: 50, economySeats: 50, category: 'regional_jet' },
  CRJ7: { iataCode: 'CRJ7', totalSeats: 70, economySeats: 66, category: 'regional_jet' },
  CRJ9: { iataCode: 'CRJ9', totalSeats: 76, economySeats: 70, category: 'regional_jet' },
  CRJX: { iataCode: 'CRJX', totalSeats: 104, economySeats: 90, category: 'regional_jet' },

  // ── Turboprops ───────────────────────────────────────────────────────────────
  AT42: { iataCode: 'AT42', totalSeats: 48, economySeats: 48, category: 'turboprop' },
  AT72: { iataCode: 'AT72', totalSeats: 70, economySeats: 66, category: 'turboprop' },
  AT75: { iataCode: 'AT75', totalSeats: 70, economySeats: 66, category: 'turboprop' },
  DH8A: { iataCode: 'DH8A', totalSeats: 37, economySeats: 37, category: 'turboprop' },
  DH8B: { iataCode: 'DH8B', totalSeats: 39, economySeats: 39, category: 'turboprop' },
  DH8C: { iataCode: 'DH8C', totalSeats: 56, economySeats: 56, category: 'turboprop' },
  DH8D: { iataCode: 'DH8D', totalSeats: 78, economySeats: 72, category: 'turboprop' },
  DHC6: { iataCode: 'DHC6', totalSeats: 19, economySeats: 19, category: 'turboprop' },
  SF34: { iataCode: 'SF34', totalSeats: 34, economySeats: 34, category: 'turboprop' },
  E120: { iataCode: 'E120', totalSeats: 30, economySeats: 30, category: 'turboprop' },
  EMB:  { iataCode: 'EMB',  totalSeats: 19, economySeats: 19, category: 'turboprop' },
  BE99: { iataCode: 'BE99', totalSeats: 15, economySeats: 15, category: 'turboprop' },
  BE1X: { iataCode: 'BE1X', totalSeats: 19, economySeats: 19, category: 'turboprop' },
  B350: { iataCode: 'B350', totalSeats: 11, economySeats: 11, category: 'turboprop' },
  CN12: { iataCode: 'CN12', totalSeats: 25, economySeats: 25, category: 'turboprop' },
  CN35: { iataCode: 'CN35', totalSeats: 50, economySeats: 50, category: 'turboprop' },
  C208: { iataCode: 'C208', totalSeats: 9,  economySeats: 9,  category: 'turboprop' },
  C402: { iataCode: 'C402', totalSeats: 9,  economySeats: 9,  category: 'turboprop' },
  C404: { iataCode: 'C404', totalSeats: 10, economySeats: 10, category: 'turboprop' },
  C406: { iataCode: 'C406', totalSeats: 14, economySeats: 14, category: 'turboprop' },
  C206: { iataCode: 'C206', totalSeats: 6,  economySeats: 6,  category: 'other' },
  PC12: { iataCode: 'PC12', totalSeats: 9,  economySeats: 9,  category: 'turboprop' },
  PA31: { iataCode: 'PA31', totalSeats: 6,  economySeats: 6,  category: 'other' },
  SW4:  { iataCode: 'SW4',  totalSeats: 19, economySeats: 19, category: 'turboprop' },
  KODI: { iataCode: 'KODI', totalSeats: 9,  economySeats: 9,  category: 'turboprop' },
  BE18: { iataCode: 'BE18', totalSeats: 9,  economySeats: 9,  category: 'other' },
  D328: { iataCode: 'D328', totalSeats: 32, economySeats: 32, category: 'turboprop' },

  // ── Additional narrowbody 737 family ─────────────────────────────────────────
  B712: { iataCode: 'B712', totalSeats: 117, economySeats: 106, category: 'narrowbody' },
  B732: { iataCode: 'B732', totalSeats: 130, economySeats: 115, category: 'narrowbody' },
  B733: { iataCode: 'B733', totalSeats: 135, economySeats: 120, category: 'narrowbody' },
  B734: { iataCode: 'B734', totalSeats: 148, economySeats: 130, category: 'narrowbody' },
  B735: { iataCode: 'B735', totalSeats: 110, economySeats: 100, category: 'narrowbody' },
  B736: { iataCode: 'B736', totalSeats: 108, economySeats: 100, category: 'narrowbody' },

  // ── Boeing 747 / 777F ─────────────────────────────────────────────────────────
  B741: { iataCode: 'B741', totalSeats: 400, economySeats: 350, category: 'widebody' },
  B742: { iataCode: 'B742', totalSeats: 416, economySeats: 366, category: 'widebody' },
  B744: { iataCode: 'B744', totalSeats: 416, economySeats: 366, category: 'widebody' },
  B748: { iataCode: 'B748', totalSeats: 467, economySeats: 410, category: 'widebody' },
  B74F: { iataCode: 'B74F', totalSeats: 0,   economySeats: 0,   category: 'widebody' },
  B74S: { iataCode: 'B74S', totalSeats: 316, economySeats: 280, category: 'widebody' },
  B77F: { iataCode: 'B77F', totalSeats: 0,   economySeats: 0,   category: 'widebody' },
  B77L: { iataCode: 'B77L', totalSeats: 317, economySeats: 275, category: 'widebody' },

  // ── Airbus ────────────────────────────────────────────────────────────────────
  A318: { iataCode: 'A318', totalSeats: 132, economySeats: 120, category: 'narrowbody' },
  A306: { iataCode: 'A306', totalSeats: 266, economySeats: 240, category: 'widebody' },
  A310: { iataCode: 'A310', totalSeats: 220, economySeats: 200, category: 'widebody' },
  A31F: { iataCode: 'A31F', totalSeats: 0,   economySeats: 0,   category: 'widebody' },
  A340: { iataCode: 'A340', totalSeats: 295, economySeats: 260, category: 'widebody' },
  A342: { iataCode: 'A342', totalSeats: 250, economySeats: 220, category: 'widebody' },
  A343: { iataCode: 'A343', totalSeats: 295, economySeats: 260, category: 'widebody' },
  A345: { iataCode: 'A345', totalSeats: 313, economySeats: 275, category: 'widebody' },
  A346: { iataCode: 'A346', totalSeats: 379, economySeats: 335, category: 'widebody' },
  A339: { iataCode: 'A339', totalSeats: 287, economySeats: 250, category: 'widebody' },

  // ── Embraer / Bombardier ──────────────────────────────────────────────────────
  ER4:  { iataCode: 'ER4',  totalSeats: 50, economySeats: 50, category: 'regional_jet' },
  ERJ:  { iataCode: 'ERJ',  totalSeats: 44, economySeats: 44, category: 'regional_jet' },
  E290: { iataCode: 'E290', totalSeats: 106, economySeats: 96, category: 'regional_jet' },
  E295: { iataCode: 'E295', totalSeats: 132, economySeats: 120, category: 'regional_jet' },
  CRJ1: { iataCode: 'CRJ1', totalSeats: 50, economySeats: 50, category: 'regional_jet' },

  // ── Legacy jets (limited service) ─────────────────────────────────────────────
  B721: { iataCode: 'B721', totalSeats: 131, economySeats: 115, category: 'narrowbody' },
  B722: { iataCode: 'B722', totalSeats: 170, economySeats: 150, category: 'narrowbody' },
  DC10: { iataCode: 'DC10', totalSeats: 280, economySeats: 250, category: 'widebody' },
  DC91: { iataCode: 'DC91', totalSeats: 90,  economySeats: 80,  category: 'narrowbody' },
  DC93: { iataCode: 'DC93', totalSeats: 100, economySeats: 90,  category: 'narrowbody' },
  DC94: { iataCode: 'DC94', totalSeats: 125, economySeats: 110, category: 'narrowbody' },
  DC95: { iataCode: 'DC95', totalSeats: 135, economySeats: 120, category: 'narrowbody' },
  MD11: { iataCode: 'MD11', totalSeats: 298, economySeats: 265, category: 'widebody' },
  MD87: { iataCode: 'MD87', totalSeats: 130, economySeats: 115, category: 'narrowbody' },
  MD88: { iataCode: 'MD88', totalSeats: 150, economySeats: 135, category: 'narrowbody' },
  MD90: { iataCode: 'MD90', totalSeats: 158, economySeats: 142, category: 'narrowbody' },
  F28:  { iataCode: 'F28',  totalSeats: 85,  economySeats: 80,  category: 'narrowbody' },
  F70:  { iataCode: 'F70',  totalSeats: 79,  economySeats: 72,  category: 'regional_jet' },
  F100: { iataCode: 'F100', totalSeats: 107, economySeats: 96,  category: 'narrowbody' },
  B461: { iataCode: 'B461', totalSeats: 82,  economySeats: 76,  category: 'regional_jet' },
  B462: { iataCode: 'B462', totalSeats: 100, economySeats: 94,  category: 'regional_jet' },
  B463: { iataCode: 'B463', totalSeats: 112, economySeats: 106, category: 'regional_jet' },
  RJ85: { iataCode: 'RJ85', totalSeats: 100, economySeats: 94,  category: 'regional_jet' },
  L101: { iataCode: 'L101', totalSeats: 250, economySeats: 225, category: 'widebody' },
};

/** Default seat count when aircraft type is unknown. */
const DEFAULT_SEATS = 150;

/**
 * BTS T-100 ships aircraft types as a proprietary numeric DOT code, not an
 * IATA/ICAO code. The canonical mapping lives in BTS's L_AIRCRAFT_TYPE
 * lookup table. This table covers the ~50 codes that appear in >0.1% of
 * T-100 Segment rows post-2019 — the long tail of exotic/historic codes
 * maps to "other" and is safe to ignore for route-intelligence use cases.
 *
 * Source: https://www.transtats.bts.gov/Download_Lookup.asp?Y11x72=Y_NVePENSG_GLCR
 */
const BTS_DOT_TO_IATA: Record<string, string> = {
  // Based on the authoritative BTS L_AIRCRAFT_TYPE lookup. The modern (post-
  // 2019) MAX codes 838/839 aren't in older lookup copies — inferred from
  // real-data distributions (838 dominates US domestic = MAX 8).

  // ── Boeing 737 family ─────────────────────────────────────────────────
  '608': 'B712',          // Boeing 717-200 (MD-95)
  '612': 'B737',          // Boeing 737-700/700LR
  '614': 'B738',          // Boeing 737-800
  '616': 'B735',          // Boeing 737-500
  '617': 'B734',          // Boeing 737-400
  '619': 'B733',          // Boeing 737-300
  '620': 'B732',          // Boeing 737-100/200
  '621': 'B732',          // Boeing 737-200C
  '633': 'B736',          // Boeing 737-600
  '634': 'B739',          // Boeing 737-900
  '838': 'B38M',          // Boeing 737 MAX 8 (modern BTS code)
  '839': 'B39M',          // Boeing 737 MAX 9 (modern BTS code)
  '888': 'B739',          // Boeing 737-900ER

  // ── Boeing 757 / 767 / 777 / 787 ──────────────────────────────────────
  '622': 'B752',          // Boeing 757-200
  '623': 'B753',          // Boeing 757-300
  '624': 'B764',          // Boeing 767-400/ER
  '625': 'B762',          // Boeing 767-200/ER
  '626': 'B763',          // Boeing 767-300/300ER
  '627': 'B772',          // Boeing 777-200ER/200LR
  '637': 'B77W',          // Boeing 777-300/300ER
  '683': 'B77F',          // Boeing B777-F (freighter)
  '816': 'B741',          // Boeing 747-100
  '817': 'B742',          // Boeing 747-200/300
  '819': 'B744',          // Boeing 747-400
  '820': 'B74F',          // Boeing 747-400F
  '821': 'B748',          // Boeing 747-8
  '822': 'B74S',          // Boeing 747SP
  '823': 'B74F',          // Boeing 747-200F
  '887': 'B788',          // Boeing 787-8
  '889': 'B789',          // Boeing 787-9

  // ── Airbus narrowbody ─────────────────────────────────────────────────
  '644': 'A318',          // Airbus A318
  '694': 'A320',          // Airbus A320-100/200 (legacy classic)
  '698': 'A319',          // Airbus A319
  '699': 'A321',          // Airbus A321
  // Modern neo codes (inferred — BTS has not published final neo mappings
  // but these three are the most common unmapped codes in 2024-2026 data):
  '819_A': 'A20N',        // placeholder — A320neo (not real code)
  '820_A': 'A21N',        // placeholder — A321neo (not real code)

  // ── Airbus widebody ───────────────────────────────────────────────────
  '687': 'A333',          // Airbus A330-300
  '690': 'A306',          // Airbus A300B/C/F-100/200
  '691': 'A306',          // Airbus A300-600
  '692': 'A31F',          // Airbus A310-200C/F
  '693': 'A310',          // Airbus A310-300
  '696': 'A332',          // Airbus A330-200
  '697': 'A340',          // Airbus A340
  '871': 'A343',          // Airbus A340-300
  '872': 'A345',          // Airbus A340-500
  '873': 'A342',          // Airbus A340-200
  '874': 'A346',          // Airbus A340-600
  '882': 'A388',          // Airbus A380-800

  // ── Regional jets (Embraer / Bombardier) ──────────────────────────────
  '628': 'CRJ1',          // Canadair RJ-100
  '629': 'CRJ2',          // Canadair RJ-200/440
  '631': 'CRJ7',          // Canadair RJ-700
  '638': 'CRJ9',          // Canadair CRJ-900
  '657': 'CRJ9',          // Bombardier CRJ 705 (sub-variant)
  '673': 'E75L',          // Embraer ERJ-175
  '674': 'ERJ',           // Embraer-135
  '675': 'ER4',           // Embraer-145
  '676': 'ERJ',           // Embraer-140
  '677': 'E170',          // Embraer 170
  '678': 'E190',          // Embraer 190

  // ── Legacy jets ───────────────────────────────────────────────────────
  '601': 'F28',           // Fokker F28-1000
  '602': 'F28',           // Fokker F28-4000/6000
  '603': 'F100',          // Fokker 100
  '604': 'F70',           // Fokker 70
  '630': 'DC91',          // DC-9-10
  '635': 'DC91',          // DC-9-15F
  '640': 'DC93',          // DC-9-30
  '645': 'DC94',          // DC-9-40
  '650': 'DC95',          // DC-9-50
  '654': 'MD87',          // MD-87
  '655': 'MD88',          // DC-9 Super 80/MD-81/82/83/88
  '656': 'MD90',          // MD-90
  '710': 'B721',          // Boeing 727-100
  '711': 'B721',          // Boeing 727-100C/QC
  '715': 'B722',          // Boeing 727-200
  '730': 'DC10',          // DC-10-10
  '731': 'DC10',          // DC-10-20
  '732': 'DC10',          // DC-10-30
  '733': 'DC10',          // DC-10-40
  '735': 'DC10',          // DC-10-30CF
  '740': 'MD11',          // MD-11
  '760': 'L101',          // L-1011
  '765': 'L101',          // L-1011-500
  '866': 'B461',          // BAe-146-100
  '867': 'B462',          // BAe-146-200
  '868': 'B463',          // BAe-146-300
  '835': 'RJ85',          // Avroliner RJ85

  // ── Turboprops ────────────────────────────────────────────────────────
  '403': 'BE99',          // Beech 99 Airliner
  '404': 'BE99',          // Beech C99
  '405': 'BE1X',          // Beech 1900
  '406': 'B350',          // Beech 200 Super Kingair
  '412': 'CN12',          // Casa C212 Aviocar
  '413': 'CN35',          // Casa 235
  '415': 'C208',          // Cessna C208B Grand Caravan
  '416': 'C208',          // Cessna 208 Caravan
  '417': 'C406',          // Cessna 406
  '441': 'AT42',          // ATR-42
  '442': 'AT72',          // ATR-72
  '449': 'D328',          // Dornier 328
  '455': 'SW4',            // Fairchild Metro 23
  '456': 'SF34',          // Saab-Fairchild 340/B
  '459': 'SF34',          // Saab-Fairchild 340/A
  '461': 'E120',          // Embraer EMB-120 Brasilia
  '464': 'EMB',           // Embraer EMB-110 Bandeirante
  '479': 'PC12',          // Pilatus PC-12
  '482': 'DH8D',          // Dash 8-400 (Q400)
  '483': 'DH8A',          // Dash 8-100
  '484': 'DH8C',          // Dash 8-300
  '485': 'DHC6',          // DHC-6 Twin Otter
  '491': 'DH8B',          // Dash 8-200Q

  // ── Small GA / piston ─────────────────────────────────────────────────
  '035': 'C206',          // Cessna 206/207/210 Stationair
  '110': 'BE18',          // Beech 18 (FedEx waiver code for small aircraft)
  '125': 'C402',          // Cessna 402/402A/402B
  '128': 'C404',          // Cessna 404
  '194': 'PA31',          // Piper PA-31 Navajo
  '422': 'KODI',          // Quest Kodiak 100
  '530': 'C208',          // (mapping best-guess for small fleet — see note)
};

/**
 * Look up the typical total seat count for an aircraft type code.
 * Falls back to a conservative default if the type is not known.
 */
export function inferSeats(rawTypeCode: string): number {
  const iata = normalizeAircraftCode(rawTypeCode);
  return SEAT_REFERENCE[iata]?.totalSeats ?? DEFAULT_SEATS;
}

/**
 * Normalize a raw aircraft type code to a canonical IATA code.
 * Handles three input shapes:
 *   1. IATA/ICAO codes we already recognize (B738, A321, CRJ9, etc.)
 *   2. BTS DOT numeric codes (634, 694, 671, etc.) — mapped via
 *      BTS_DOT_TO_IATA and then canonicalized through SEAT_REFERENCE.
 *   3. Anything else — returned upper-cased, unchanged (shows up as "UNK"
 *      or "other" downstream).
 */
export function normalizeAircraftCode(rawTypeCode: string): string {
  const code = rawTypeCode.trim().toUpperCase();
  if (code in SEAT_REFERENCE) return SEAT_REFERENCE[code].iataCode;
  if (code in BTS_DOT_TO_IATA) {
    const iata = BTS_DOT_TO_IATA[code];
    return SEAT_REFERENCE[iata]?.iataCode ?? iata;
  }
  return code;
}

/**
 * Return the aircraft category for the given type code.
 */
export function getAircraftCategory(
  rawTypeCode: string
): AircraftSeatReference['category'] {
  const iata = normalizeAircraftCode(rawTypeCode);
  return SEAT_REFERENCE[iata]?.category ?? 'other';
}
