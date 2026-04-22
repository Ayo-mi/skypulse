// ─────────────────────────────────────────────────────────────────────────────
// Shared TypeScript types and interfaces for SkyPulse
// ─────────────────────────────────────────────────────────────────────────────

// ── Reference entity types ───────────────────────────────────────────────────

export interface Airport {
  iata_code: string;
  icao_code: string | null;
  name: string;
  city: string;
  country: string;
  metro_area: string | null;
}

export interface Carrier {
  iata_code: string;
  icao_code: string | null;
  name: string;
  country: string;
  carrier_type: 'mainline' | 'regional' | 'lowcost' | 'charter' | 'cargo' | 'other';
}

export interface AircraftType {
  iata_type_code: string;
  manufacturer: string;
  model: string;
  family: string | null;
  typical_seats_economy: number | null;
  typical_seats_total: number | null;
  category: 'narrowbody' | 'widebody' | 'regional_jet' | 'turboprop' | 'other';
}

// ── Snapshot / change types ───────────────────────────────────────────────────

export interface RouteSnapshot {
  id: number;
  origin: string;
  destination: string;
  carrier: string;
  period: string;
  period_type: 'weekly' | 'monthly' | 'quarterly';
  frequency: number;
  inferred_seats: number | null;
  aircraft_type_mix: Record<string, number> | null;
  source: 'dot_t100' | 'faa_opsnet' | 'announcement';
  source_vintage: Date | null;
  ingested_at: Date;
}

export type ChangeType =
  | 'launch'
  | 'suspension'
  | 'resumption'
  | 'growth'
  | 'reduction'
  | 'gauge_up'
  | 'gauge_down';

export interface RouteChange {
  id: number;
  origin: string;
  destination: string;
  carrier: string;
  comparison_period: string;
  prior_frequency: number | null;
  current_frequency: number | null;
  frequency_change_abs: number | null;
  frequency_change_pct: number | null;
  prior_inferred_seats: number | null;
  current_inferred_seats: number | null;
  capacity_change_abs: number | null;
  capacity_change_pct: number | null;
  aircraft_type_mix_prior: Record<string, number> | null;
  aircraft_type_mix_current: Record<string, number> | null;
  change_type: ChangeType;
  as_of: Date;
  confidence: number;
  known_unknowns: string | null;
  source_refs: SourceRef[];
  computed_at: Date;
}

export interface RouteAnnouncement {
  id: number;
  carrier: string;
  origin: string;
  destination: string;
  announcement_type: 'launch' | 'suspension' | 'resumption' | 'frequency_change';
  effective_date: Date | null;
  announced_date: Date | null;
  source_url: string | null;
  source_text: string | null;
  processed: boolean;
  created_at: Date;
}

// ── Freshness / metadata types ────────────────────────────────────────────────

export interface SourceRef {
  source: string;
  vintage: string;
  url?: string;
}

export interface FreshnessMetadata {
  as_of: string;
  comparison_period: string;
  source_refs: SourceRef[];
  confidence: number;
  known_unknowns: string;
  data_freshness: string;
}

// ── Tool input / output types ─────────────────────────────────────────────────

export interface RouteCapacityChangeInput {
  origin: string;
  destination: string;
  days_back?: number;
}

export interface RouteCapacityChangeResult extends FreshnessMetadata {
  origin: string;
  destination: string;
  changes: RouteChangeDetail[];
}

export interface RouteChangeDetail {
  carrier: string;
  carrier_name?: string;
  comparison_period: string;
  change_type: ChangeType;
  prior_frequency: number | null;
  current_frequency: number | null;
  frequency_change_abs: number | null;
  frequency_change_pct: number | null;
  prior_inferred_seats: number | null;
  current_inferred_seats: number | null;
  capacity_change_abs: number | null;
  capacity_change_pct: number | null;
  aircraft_type_mix_prior: Record<string, number> | null;
  aircraft_type_mix_current: Record<string, number> | null;
  confidence: number;
  known_unknowns: string | null;
  source_refs: SourceRef[];
}

export interface NewRouteLaunchesInput {
  airport: string;
  period?: string;
}

export interface NewRouteEntry {
  carrier: string;
  carrier_name?: string;
  origin: string;
  destination: string;
  change_type: 'launch' | 'resumption';
  comparison_period: string;
  current_frequency: number | null;
  current_inferred_seats: number | null;
  effective_date: string;
  confidence: number;
  source_refs: SourceRef[];
}

export interface NewRouteLaunchesResult extends FreshnessMetadata {
  airport: string;
  period: string;
  routes: NewRouteEntry[];
}

export interface FrequencyLosersInput {
  market?: string;
  period?: string;
}

export interface FrequencyLoserEntry {
  origin: string;
  destination: string;
  carrier: string;
  carrier_name?: string;
  comparison_period: string;
  frequency_change_pct: number;
  frequency_change_abs: number;
  prior_frequency: number;
  current_frequency: number;
  confidence: number;
}

export interface FrequencyLosersResult extends FreshnessMetadata {
  market: string | null;
  period: string | null;
  losers: FrequencyLoserEntry[];
}

export interface CapacityDriverAnalysisInput {
  origin: string;
  destination: string;
  carrier?: string;
}

export interface CapacityDriverDetail {
  carrier: string;
  carrier_name?: string;
  comparison_period: string;
  driver: 'frequency_driven' | 'gauge_driven' | 'mixed' | 'flat' | 'decline';
  frequency_change_pct: number | null;
  capacity_change_pct: number | null;
  aircraft_type_mix_prior: Record<string, number> | null;
  aircraft_type_mix_current: Record<string, number> | null;
  confidence: number;
  known_unknowns: string | null;
}

export interface CapacityDriverAnalysisResult extends FreshnessMetadata {
  origin: string;
  destination: string;
  carrier: string | null;
  analysis: CapacityDriverDetail[];
}

export interface CarrierCapacityRankingInput {
  market: string;
  aircraft_category?: string;
  period?: string;
}

export interface CarrierRankEntry {
  rank: number;
  carrier: string;
  carrier_name?: string;
  total_capacity_change_abs: number;
  total_capacity_change_pct: number;
  total_current_seats: number;
  total_prior_seats: number;
  routes_gained: number;
  routes_lost: number;
  routes_unchanged: number;
}

export interface CarrierCapacityRankingResult extends FreshnessMetadata {
  market: string;
  aircraft_category: string | null;
  period: string | null;
  ranking: CarrierRankEntry[];
}

// ── Error types ───────────────────────────────────────────────────────────────

export interface SkyPulseError {
  code: string;
  message: string;
  details?: unknown;
}

// ── Ingestion types ───────────────────────────────────────────────────────────

export interface T100Row {
  CARRIER: string;
  ORIGIN: string;
  DEST: string;
  AIRCRAFT_TYPE: string;
  DEPARTURES_SCHEDULED: string;
  DEPARTURES_PERFORMED: string;
  SEATS: string;
  PASSENGERS: string;
  FREIGHT: string;
  DISTANCE: string;
  MONTH: string;
  YEAR: string;
}

export interface NormalizedT100Row {
  carrier: string;
  origin: string;
  destination: string;
  aircraft_type: string;
  departures_scheduled: number;
  departures_performed: number;
  seats: number;
  passengers: number;
  freight: number;
  distance: number;
  month: number;
  year: number;
  period: string;
}
