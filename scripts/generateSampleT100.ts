/**
 * Generate a synthetic but realistic DOT T-100 Segment fixture CSV.
 *
 * Output: fixtures/sample_t100.csv (9 months: 2025-07 through 2026-03)
 *
 * Designed so that when run through the SkyPulse ingest + recompute
 * pipeline it produces at least one of each change type:
 *   • launch        UA JFK-LAX (starts Jan 2026)
 *   • suspension    F9 ORD-DEN (drops to zero in Q1 2026)
 *   • launch        WN ATL-MIA (starts Dec 2025)
 *   • growth        B6 JFK-LAX  (+ ~58% capacity)
 *   • growth        WN ORD-DEN  (+ ~44% capacity)
 *   • reduction     NK BOS-MCO  (− ~42% capacity)
 *   • unchanged     AA JFK-LAX, DL JFK-LAX, UA ORD-DEN, B6 BOS-MCO, AS SEA-PDX,
 *                   OO SEA-PDX, DL ATL-MIA
 *   • aircraft mix  AA DFW-PHX  (E175 regional → B738 mainline upgauge)
 *
 * Run with: `npm run fixture:t100`  (see package.json script).
 */

import * as fs from 'fs';
import * as path from 'path';

interface Segment {
  carrier: string;
  origin: string;
  dest: string;
  /**
   * For each (year, month) in the run, return [aircraft, departures, seats]
   * for the segment. Return null to omit the row (segment not operated).
   */
  schedule(year: number, month: number): Array<[string, number, number]> | null;
}

// month index: 0 = 2025-07, 1 = 2025-08, ..., 8 = 2026-03
function monthIdx(year: number, month: number): number {
  return (year - 2025) * 12 + (month - 7);
}

function seatsFor(aircraft: string): number {
  const table: Record<string, number> = {
    B738: 189,
    B737: 149,
    A321: 220,
    A320: 180,
    A319: 144,
    E175: 78,
  };
  return table[aircraft] ?? 150;
}

const segments: Segment[] = [
  // ── JFK-LAX transcon ─────────────────────────────────────────────────────
  {
    carrier: 'AA',
    origin: 'JFK',
    dest: 'LAX',
    schedule: (_y, m) => {
      // Steady ~120 flights/month split B738/A321
      const base = [118, 120, 122, 119, 121, 120, 118, 118, 120][monthIdx(_y, m)];
      return [
        ['B738', Math.round(base * 0.6), Math.round(base * 0.6) * seatsFor('B738')],
        ['A321', Math.round(base * 0.4), Math.round(base * 0.4) * seatsFor('A321')],
      ];
    },
  },
  {
    carrier: 'DL',
    origin: 'JFK',
    dest: 'LAX',
    schedule: (_y, m) => {
      const base = [114, 115, 116, 115, 117, 115, 114, 114, 115][monthIdx(_y, m)];
      return [['A321', base, base * seatsFor('A321')]];
    },
  },
  {
    carrier: 'B6',
    origin: 'JFK',
    dest: 'LAX',
    // Growth: Q3 avg 60 → Q1'26 avg 95
    schedule: (_y, m) => {
      const rampedSeries = [60, 62, 58, 70, 75, 82, 95, 93, 97];
      const v = rampedSeries[monthIdx(_y, m)];
      return [['A321', v, v * seatsFor('A321')]];
    },
  },
  {
    carrier: 'UA',
    origin: 'JFK',
    dest: 'LAX',
    // Launch in Q1 2026 (JFK-LAX returned to UA schedule)
    schedule: (_y, m) => {
      const idx = monthIdx(_y, m);
      if (idx < 6) return null; // nothing in Q3-Q4 2025
      const v = [45, 48, 50][idx - 6];
      return [['B738', v, v * seatsFor('B738')]];
    },
  },
  // ── ORD-DEN hub-hub ──────────────────────────────────────────────────────
  {
    carrier: 'UA',
    origin: 'ORD',
    dest: 'DEN',
    schedule: (_y, m) => {
      const v = [148, 150, 152, 149, 151, 150, 150, 148, 152][monthIdx(_y, m)];
      return [['B738', v, v * seatsFor('B738')]];
    },
  },
  {
    carrier: 'F9',
    origin: 'ORD',
    dest: 'DEN',
    // Suspension: 40 → 25 → 0
    schedule: (_y, m) => {
      const series = [40, 42, 38, 28, 25, 22, 0, 0, 0];
      const v = series[monthIdx(_y, m)];
      if (v === 0) return null;
      return [['A320', v, v * seatsFor('A320')]];
    },
  },
  {
    carrier: 'WN',
    origin: 'ORD',
    dest: 'DEN',
    // Growth: Q3 avg 80 → Q1 avg 115
    schedule: (_y, m) => {
      const series = [78, 80, 82, 95, 100, 110, 115, 113, 117];
      const v = series[monthIdx(_y, m)];
      return [['B738', v, v * seatsFor('B738')]];
    },
  },
  // ── ATL-MIA ──────────────────────────────────────────────────────────────
  {
    carrier: 'DL',
    origin: 'ATL',
    dest: 'MIA',
    schedule: (_y, m) => {
      const v = [138, 140, 142, 139, 141, 140, 138, 139, 141][monthIdx(_y, m)];
      return [
        ['A321', Math.round(v * 0.5), Math.round(v * 0.5) * seatsFor('A321')],
        ['B738', Math.round(v * 0.5), Math.round(v * 0.5) * seatsFor('B738')],
      ];
    },
  },
  {
    carrier: 'WN',
    origin: 'ATL',
    dest: 'MIA',
    // Launch starting Dec 2025
    schedule: (_y, m) => {
      const idx = monthIdx(_y, m);
      if (idx < 5) return null;
      const v = [20, 40, 42, 44][idx - 5];
      return [['B738', v, v * seatsFor('B738')]];
    },
  },
  // ── BOS-MCO ──────────────────────────────────────────────────────────────
  {
    carrier: 'B6',
    origin: 'BOS',
    dest: 'MCO',
    schedule: (_y, m) => {
      const v = [98, 100, 102, 99, 101, 100, 98, 100, 101][monthIdx(_y, m)];
      return [['A320', v, v * seatsFor('A320')]];
    },
  },
  {
    carrier: 'NK',
    origin: 'BOS',
    dest: 'MCO',
    // Reduction: Q3 ~60 → Q1 ~35
    schedule: (_y, m) => {
      const series = [62, 60, 58, 52, 48, 42, 36, 34, 35];
      const v = series[monthIdx(_y, m)];
      return [['A320', v, v * seatsFor('A320')]];
    },
  },
  // ── DFW-PHX (aircraft upgauge) ───────────────────────────────────────────
  {
    carrier: 'AA',
    origin: 'DFW',
    dest: 'PHX',
    // Q3-Q4 2025: regional E175 dominant. Q1 2026: swap to B738 mainline.
    schedule: (_y, m) => {
      const idx = monthIdx(_y, m);
      if (idx < 6) {
        const v = [80, 82, 78, 80, 82, 78][idx];
        return [['E175', v, v * seatsFor('E175')]];
      }
      const v = [60, 62, 58][idx - 6];
      return [['B738', v, v * seatsFor('B738')]];
    },
  },
  // ── SEA-PDX short-haul ───────────────────────────────────────────────────
  {
    carrier: 'AS',
    origin: 'SEA',
    dest: 'PDX',
    schedule: (_y, m) => {
      const v = [88, 90, 92, 89, 91, 90, 88, 89, 90][monthIdx(_y, m)];
      return [
        ['B738', Math.round(v * 0.7), Math.round(v * 0.7) * seatsFor('B738')],
        ['A320', Math.round(v * 0.3), Math.round(v * 0.3) * seatsFor('A320')],
      ];
    },
  },
  {
    carrier: 'OO',
    origin: 'SEA',
    dest: 'PDX',
    schedule: (_y, m) => {
      const v = [48, 50, 52, 49, 51, 50, 48, 50, 51][monthIdx(_y, m)];
      return [['E175', v, v * seatsFor('E175')]];
    },
  },
];

const header = [
  'UNIQUE_CARRIER',
  'ORIGIN',
  'DEST',
  'AIRCRAFT_TYPE',
  'DEPARTURES_SCHEDULED',
  'DEPARTURES_PERFORMED',
  'SEATS',
  'PASSENGERS',
  'DISTANCE',
  'MONTH',
  'YEAR',
];

const lines: string[] = [header.join(',')];

for (let idx = 0; idx < 9; idx++) {
  const year = idx <= 5 ? 2025 : 2026;
  const month = idx <= 5 ? 7 + idx : idx - 5;
  for (const seg of segments) {
    const ops = seg.schedule(year, month);
    if (!ops) continue;
    for (const [aircraft, deps, seats] of ops) {
      if (deps <= 0) continue;
      const passengers = Math.round(seats * 0.82); // ~82% load factor
      const distance = distanceFor(seg.origin, seg.dest);
      lines.push(
        [
          seg.carrier,
          seg.origin,
          seg.dest,
          aircraft,
          deps,
          deps,
          seats,
          passengers,
          distance,
          month,
          year,
        ].join(',')
      );
    }
  }
}

function distanceFor(o: string, d: string): number {
  const key = `${o}-${d}`;
  const table: Record<string, number> = {
    'JFK-LAX': 2475,
    'ORD-DEN': 888,
    'ATL-MIA': 594,
    'BOS-MCO': 1121,
    'DFW-PHX': 868,
    'SEA-PDX': 129,
  };
  return table[key] ?? 500;
}

// Written outside ./data/ so `npm run ingest:t100 -- --dir ./data` will not
// accidentally pick up the fixture alongside real BTS ZIPs.
const outPath = path.join(process.cwd(), 'fixtures', 'sample_t100.csv');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, lines.join('\n') + '\n', 'utf8');
// eslint-disable-next-line no-console
console.log(
  `Wrote ${lines.length - 1} rows spanning 2025-07..2026-03 to ${outPath}`
);
