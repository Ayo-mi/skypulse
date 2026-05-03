-- SkyPulse Migration 009
-- Scrub the legacy "press release corroboration" wording from the
-- known_unknowns column on every existing route_changes row.
--
-- WHY: When SkyPulse was reframed as historical BTS intelligence
-- (round-1 grant feedback), we removed the announcement-layer claim
-- from the listing description and from the freshness-builder code,
-- but the per-row known_unknowns column was populated by the
-- recomputeRouteChanges pipeline before that reframing and now holds
-- 100k+ rows that still say "No press release corroboration found.
-- Single data source only — cross-validation not possible".
--
-- Every per-row response from route_capacity_change and
-- capacity_driver_analysis surfaces that string verbatim, which
-- contradicts our promise to drop the announcement claim. Rewrite
-- to language that just describes the single-source nature of T-100,
-- with no mention of a press-release layer we don't ship.
--
-- Idempotent: any row already carrying the new wording is left alone.
-- Future ingests use the same wording (see
-- src/normalization/confidenceScoring.ts).

UPDATE route_changes
SET known_unknowns = 'Single data source (BTS T-100 Segment only) — no cross-source validation. ' ||
                     CASE
                       WHEN known_unknowns LIKE '%months old — recent changes may not be reflected%'
                         THEN regexp_replace(
                                substring(known_unknowns from position('Data is' in known_unknowns)),
                                'recent changes may not be reflected',
                                'recent changes may not yet be reflected'
                              )
                       ELSE 'Subject to the standard 3-6 month BTS publication lag.'
                     END
WHERE known_unknowns LIKE 'No press release corroboration found%';
