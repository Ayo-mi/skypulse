import { ChangeType, RouteSnapshot } from '../types/index';

const SUSPENSION_THRESHOLD = 0.95; // 95%+ reduction in frequency → suspension

interface ChangeClassificationInput {
  prior: RouteSnapshot | null;
  current: RouteSnapshot | null;
}

interface ChangeClassification {
  changeType: ChangeType;
  frequencyChangePct: number | null;
  capacityChangePct: number | null;
  frequencyChangeAbs: number | null;
  capacityChangeAbs: number | null;
}

/**
 * Classify the change between two consecutive route snapshots.
 *
 * Rules (in priority order):
 *  - No prior   → launch
 *  - No current → suspension
 *  - Was zero, now > 0 → resumption
 *  - Now zero   → suspension
 *  - Frequency up, seats up proportionally → growth
 *  - Frequency down → reduction
 *  - Frequency flat/down but seats up → gauge_up
 *  - Frequency flat/up but seats down → gauge_down
 */
export function classifyChange(input: ChangeClassificationInput): ChangeClassification {
  const { prior, current } = input;

  if (!prior) {
    return {
      changeType: 'launch',
      frequencyChangePct: null,
      capacityChangePct: null,
      frequencyChangeAbs: null,
      capacityChangeAbs: null,
    };
  }

  if (!current) {
    return {
      changeType: 'suspension',
      frequencyChangePct: prior.frequency > 0 ? -100 : null,
      capacityChangePct:
        prior.inferred_seats && prior.inferred_seats > 0 ? -100 : null,
      frequencyChangeAbs: prior.frequency > 0 ? -prior.frequency : null,
      capacityChangeAbs:
        prior.inferred_seats && prior.inferred_seats > 0
          ? -prior.inferred_seats
          : null,
    };
  }

  const priorFreq = prior.frequency;
  const currFreq = current.frequency;
  const priorSeats = prior.inferred_seats ?? 0;
  const currSeats = current.inferred_seats ?? 0;

  const freqChangeAbs = currFreq - priorFreq;
  const freqChangePct =
    priorFreq > 0 ? ((currFreq - priorFreq) / priorFreq) * 100 : null;

  const seatChangeAbs = currSeats - priorSeats;
  const seatChangePct =
    priorSeats > 0 ? ((currSeats - priorSeats) / priorSeats) * 100 : null;

  // Was suspended (zero freq), now active → resumption
  if (priorFreq === 0 && currFreq > 0) {
    return {
      changeType: 'resumption',
      frequencyChangePct: null,
      capacityChangePct: null,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  // Now effectively zero → suspension
  if (
    currFreq === 0 ||
    (freqChangePct !== null && freqChangePct <= -SUSPENSION_THRESHOLD * 100)
  ) {
    return {
      changeType: 'suspension',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  // Determine primary driver
  const freqUp = freqChangePct !== null && freqChangePct > 5;
  const freqDown = freqChangePct !== null && freqChangePct < -5;
  const seatsUp = seatChangePct !== null && seatChangePct > 5;
  const seatsDown = seatChangePct !== null && seatChangePct < -5;

  if (freqUp && seatsUp) {
    return {
      changeType: 'growth',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  if (freqDown) {
    return {
      changeType: 'reduction',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  if (seatsUp && !freqDown) {
    return {
      changeType: 'gauge_up',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  if (seatsDown && !freqUp) {
    return {
      changeType: 'gauge_down',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  // No significant change — still classify as growth/reduction based on direction
  if (freqUp) {
    return {
      changeType: 'growth',
      frequencyChangePct: freqChangePct,
      capacityChangePct: seatChangePct,
      frequencyChangeAbs: freqChangeAbs,
      capacityChangeAbs: seatChangeAbs,
    };
  }

  return {
    changeType: 'reduction',
    frequencyChangePct: freqChangePct,
    capacityChangePct: seatChangePct,
    frequencyChangeAbs: freqChangeAbs,
    capacityChangeAbs: seatChangeAbs,
  };
}
