# ADR 0001 — Property-data platform for the Intelligence Hub

- Status: **Proposed** (2026-09-24)
- Deciders: Jason Wiersma
- Detail: [../INTELLIGENCE-HUB-DATA-PLATFORM.md](../INTELLIGENCE-HUB-DATA-PLATFORM.md)

## Context

Property data today is a monthly laptop script (`extract-cook.ts`) that writes Cook County parcels into the pricing app's
KV, keyed by address. It keeps no history, no raw copy, no validation and no record of who ran it or when. The
Intelligence Hub (v1) shows imports, coverage and quality on mock data. ARR wants operators to run imports from the
Hub, keep every source value over time, and serve the same data to the pricing app and future projects. Cook County
blocks datacenter IP ranges, so the import can't simply run in the cloud.

## Decisions

1. **Supabase Postgres + PostGIS is the system of record** for property, ingestion, governance and weather data.
   KV becomes an optional read cache in front of an API. R2 holds immutable raw snapshots.
2. **Property identity is `(jurisdiction, parcel_id)`**, never address text. Addresses are a child table used for
   lookup. Per-year facts are keyed `(property, source, source_year, card)`. Versions are append-only, deduplicated by
   record hash, so reruns are idempotent.
3. **Imports are durable jobs, not requests.** The browser submits a validated definition; a runner claims it with a
   lease (`FOR UPDATE SKIP LOCKED`), checkpoints per batch, and honours cancellation. The queue is the Postgres job
   table, not Cloudflare Queues: one fewer service, and it works from an office machine.
4. **One ImportService, three hosts.** Hub routes, the CLI and the worker all call `packages/property-data`'s
   `ImportService`. Cook jobs run on an **office agent** (outbound-only, least-privilege DB role); the CLI covers
   recovery; a cloud worker handles sources that allow datacenter traffic.
5. **Stage, validate, then publish in one transaction.** A failed gate or a failed publish leaves the published
   dataset untouched. A dry run stops after validation.
6. **Server-controlled enums everywhere.** Source, jurisdiction, area type, mode, datasets and area values come from a
   server catalog; no browser string reaches a source query.
7. **Manual corrections are overlays** (`governance.manual_overrides`) read through a view; source values are never
   overwritten.
8. **Roles viewer / analyst / operator / admin**, enforced in application code *and* Postgres RLS; MFA required for
   operator and admin in production. No component uses `service_role`.
9. **Incremental extraction.** New `packages/property-data` and `apps/property-ingestion`; `packages/county` gains
   connectors while keeping the exports the pricing Worker imports; `apps/property-api` waits until there is data to
   serve. The pricing app's production lookup doesn't change until a shadow comparison passes and Jason approves.

## Alternatives considered

- **Keep KV as the store and add metadata.** Rejected: no history, no relational queries for coverage and analytics,
  and no transactions for an atomic publish.
- **Cloudflare D1.** Rejected for now: no PostGIS, weaker row-level security story, and size limits for the target
  dataset.
- **Cloudflare Queues + Workers for ingestion.** Rejected as the primary path: Cook blocks datacenter egress, and a
  Postgres job table gives visibility (the Hub reads it directly) without another service. It can be added later as a
  wake-up signal.
- **Run the import inside the Hub request.** Rejected: Worker CPU and time limits, lost work on tab close, and a
  browser-to-shell attack surface.
- **Address as the key.** Rejected: addresses change spelling, units and normalization rules; PINs are the
  assessor's identity.

## Consequences

- A Postgres database becomes a paid, backed-up dependency (Supabase Pro for production).
- An office machine becomes part of the Cook ingestion path; it needs monitoring (heartbeat) and a runbook.
- Two layers of authorization to keep in step; tests cover both.
- The pricing app gains a second data path only after a measured shadow period; the three-question fallback stays
  permanently.
