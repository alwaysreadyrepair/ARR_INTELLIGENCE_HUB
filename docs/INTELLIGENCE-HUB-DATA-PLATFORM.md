# Intelligence Hub — property-data platform (Phase 2 plan)

Status: **proposed**. Nothing here is provisioned. Decision record: [adr/0001-property-data-platform.md](adr/0001-property-data-platform.md).

Goal: an authorized operator starts, watches and validates a county property import from the Intelligence Hub. The
result is a versioned, provenance-tracked property database that the pricing app and later ARR projects read through one
Property Data API.

---

## 1. Current implementation (as of `2fe9b46`, 2026-09-24)

| Piece | Where | What it does today | Gaps for Phase 2 |
|---|---|---|---|
| Cook bulk extract | `packages/county/scripts/extract-cook.ts` | Pages Parcel Universe (`tx2p-k2g9`, year 2023) by township, joins residential characteristics (`x54s-btds`, year 2024) 500 PINs at a time, and writes KV JSONL keyed by **address** (`p:<addressKey>`) to stdout. Run by hand from a laptop. | Township names are interpolated into SoQL (fine from an env var, an injection vector from a browser); source years are hard-coded; multi-card parcels silently keep the lowest card; parcels without characteristics or an address are dropped without a count; no checkpoint, no raw copy, no validation, no provenance; permits and sales are not loaded. |
| Cook live client | `packages/county/src/cook.ts` | Per-address SODA lookups (PIN → chars, permits, sales). Runs **inside the pricing Worker**, so it must stay `fetch`-only. | Reused as-is. The bulk connector shares its field mapping (`CHAR_SELECT`, `storiesFromType`, `labelFromChars`). |
| Address normalization | `packages/county/src/normalize.ts` | Matches the Cook Assessor's spelling; decides county from the city. | Must remain the **single** normalizer for pricing and the database, or lookups will stop matching. |
| Will County | `packages/county/src/will.ts` | Stub, returns `null`; the widget asks three questions instead. | Stays an explicit *unsupported* connector. No data is fabricated. |
| Pricing lookup | `apps/pricing/src/lib/lookup.ts`, `/api/lookup` | KV `p:<addressKey>` → live Cook → Will stub → `{source:'none'}`, cached back to KV. | Production path. **Not changed in this phase.** See §9 for exposure notes. |
| Intelligence Hub | `apps/intelligence-hub` | Astro SSR (Cloudflare adapter), 10 routes on mock data behind `repositories/types.ts`, `load()` states, stub user, read-only. | Has its own `domain/types.ts`. Imports UI is read-only; there's no job API, no auth and no shared package. |

## 2. Target architecture

```
 Browser (Hub UI) ──POST validated job definition──▶ Hub server routes (/api/import-jobs*)
                                                        │  authorize(user, action) · zod schema · audit event
                                                        ▼
                                               ImportService (packages/property-data)
                                                        │  jobs repo: insert status=pending
                                                        ▼
 ┌──────────── Supabase Postgres + PostGIS (authoritative) ────────────┐
 │ ingestion.jobs ◀── claim (lease, SKIP LOCKED) ── Ingestion runner ──┼──▶ Cook SODA (office network)
 │ staging.*  → validate → publish (one transaction) → core/facts/history
 │ governance.* (audit, overrides, roles)  weather.*  analytics views   │
 └───────────────────────────────────────────────────────────────────────┘
                                                        │ raw pages (gzip JSONL, sha256)
                                                        ▼
                                          R2 (prod) / local filesystem (dev) — immutable snapshots
 Property Data API (later) ──reads──▶ Postgres ──▶ KV read cache ──▶ pricing app
```

**The rule that shapes everything: a browser request never runs an import.** It inserts a validated job row and
returns. A separate runner process claims the job, executes it, checkpoints after every batch, and can be stopped,
resumed or retried. The operator can close the tab.

### Workspace layout

Adjusted from the proposal: extract incrementally, create nothing empty.

| Path | Status | Contents |
|---|---|---|
| `packages/property-data` | **new** | Domain types, zod schemas, area catalog (server-side enums), job state machine, `authorize()`, repository interfaces, in-memory adapters, Postgres adapter scaffold, snapshot interfaces (R2 + filesystem), `ImportService`, validation gates. The core has no `node:` imports, so it runs in Workers and Node. Node-only pieces (filesystem snapshots, `postgres` driver) sit behind a `./node` entry point. |
| `packages/county` | **extended** | New `connectors/` with a `SourceConnector` interface, `cook` connector (paging, rate limit, backoff, `AbortSignal`) and a `will` connector that declares itself unsupported. Existing `cook.ts` / `normalize.ts` / `will.ts` exports are unchanged because the pricing Worker imports them. `extract-cook.ts` becomes a thin wrapper over the connector and writes **byte-compatible** KV JSONL, so today's KV load path keeps working. |
| `apps/property-ingestion` | **new** | Node CLI + worker loop: `npm run property:import`, `npm run property:worker`. The same `ImportService` the Hub calls. |
| `apps/intelligence-hub` | **extended** | `/api/import-jobs*` routes, a New Import screen, and a job-detail screen. The Hub's repository interfaces move to `packages/property-data`, with `domain/types.ts` re-exporting from there during the move. |
| `apps/property-api` | **deferred to Phase D** | Created when there's a database to serve and a shadow comparison to run. An empty app now would only drift. |
| `supabase/migrations` | **new** | Timestamped SQL, plus `supabase/tests/*.sql` RLS and constraint tests. |

## 3. Database model

Schemas separate concerns and let grants and RLS be written per schema. Every table has `created_at`. Mutable tables
also have `updated_at`. Primary keys are `uuid` (`gen_random_uuid()`) unless a natural key is stated. Coordinates are
`geography(Point, 4326)`.

### core / facts / history — property data (public-record information only)

| Table | Key columns | Identity / dedup |
|---|---|---|
| `core.properties` | jurisdiction (`il-cook`, `il-will`), parcel_id (PIN), county, township, municipality, zip, `location`, source_year, collected_at, last_published_at, snapshot_id, record_hash, status (`current` · `stale` · `retired`) | **`unique (jurisdiction, parcel_id)`**. Address text is never the identity. |
| `core.property_addresses` | property_id, address_line, normalized_key (`addressKey()`), city, state, zip, is_primary, source, valid_from/valid_to | `unique (property_id, normalized_key)`. This table is how the pricing lookup (address in) finds a PIN. |
| `facts.residential_characteristics` | property_id, source, source_year, card_number, is_primary_card, sqft, year_built, stories, style, ext_wall, basement, basement_finish, central_air, heating_raw, rooms, record_hash, job_id, snapshot_id | **`unique (property_id, source, source_year, card_number)`**. Every card is stored; `is_primary_card` follows today's rule (lowest card number). |
| `facts.permits` | property_id, source, permit_number, issued_on, description, work_type, is_hvac, record_hash | `unique (property_id, source, dedupe_key)`, where `dedupe_key` = the permit number, or else a hash of (issued_on, description). |
| `facts.sales` | property_id, source, sale_date, price, document_number, deed_type | `unique (property_id, source, dedupe_key)`. **analyst+ only** under RLS (internal). |
| `history.property_versions` | property_id, version, source, source_year, facts `jsonb` (canonical projection), record_hash, changed_fields `text[]`, job_id, snapshot_id, captured_at | `unique (property_id, source, source_year, record_hash)`. A rerun with unchanged data inserts nothing. A change inserts a new version; old versions are never updated or deleted. |
| `core.property_effective` (view) | source facts + latest active manual override per field + `overridden_fields` | What the Hub and the API read. The source values stay intact. |

### staging — import landing zone

`staging.parcel_rows (job_id, batch_id, parcel_id, raw jsonb, normalized jsonb, record_hash, verdict, issues jsonb)`
and the equivalents for permits and sales. Rows are written per batch, validated in place, and published in one
transaction. They're deleted N days after the job reaches a terminal state.

### ingestion — the control plane

| Table | Purpose |
|---|---|
| `ingestion.jobs` | id, source (enum), jurisdiction, area_type (`township` · `zip` · `municipality` · `custom`), areas `text[]`, source_year, mode (`full` · `incremental` · `dry_run`), datasets `text[]`, record_limit, status (enum §4), counts (discovered, downloaded, accepted, rejected, inserted, updated, unchanged), checkpoint `jsonb`, runner_requirement (`office` · `any`), lease_owner, lease_expires_at, heartbeat_at, retry_count, max_retries, dead_lettered, idempotency_key (**unique**, so a double-submit creates one job), requested_by, requested_at, started_at, completed_at, error `jsonb` (`{code, message, retryable, detail}`) |
| `ingestion.job_batches` | job_id, dataset, seq, cursor range, status, counts, snapshot_id, attempts. **`unique (job_id, dataset, seq)`**, so a duplicate delivery of a batch is a no-op. |
| `ingestion.job_events` | Structured log: job_id, batch_id, at, level, code, message, data. The job-detail screen reads this. |
| `ingestion.snapshots` | job_id, batch_id, source, dataset, storage (`r2` · `fs`), object_key, sha256, bytes, record_count, retained_until. `unique (object_key)`. |
| `ingestion.coverage` | (jurisdiction, area_type, area_id, dataset, source_year), with parcels_expected, homes_indexed, missing-field counts, last_job_id and last_published_at. Recomputed at publish. |
| `ingestion.quality_issues` | rule (enum §6), severity, status, job_id, property_id, area, detail, detected_at, resolved_by/at |
| `ingestion.area_catalog` | The server-controlled list of importable areas per jurisdiction and area type: Cook Assessor township names, service-area ZIPs. **The API validates against this; it never takes free text.** |

### governance

| Table | Notes |
|---|---|
| `governance.user_roles` | user_id → `viewer` · `analyst` · `operator` · `admin`. A Supabase custom access-token hook copies the role into the JWT, and RLS reads it from there. |
| `governance.projects`, `governance.api_clients` | api_clients stores the **hash** and a display prefix only, plus scopes (datasets, territories), a rate limit and revoked_at. |
| `governance.audit_events` | Append-only: actor, action, target, detail, request id, at. Insert-only grant; no update or delete for anyone except the migration owner. |
| `governance.manual_overrides` | property_id, field, value `jsonb`, reason (required), author, created_at, superseded_at. An overlay that is **never** written back into `facts.*`. |

### weather — stored once per station or grid, never per property

`weather.stations` (GHCN id, name, location, NWS grid) · `weather.daily_observations` (**PK station_id, date**:
tmax/tmin/tavg, hdd, cdd on a 65 °F base, precip, snow, source, collected_at) · `weather.hourly_forecasts` (**PK grid_id,
valid_at, issued_at**) · `weather.alerts` (NWS id PK, zone, event, severity, onset/ends, raw) ·
`weather.area_station_mapping` (area_type, area_id → station_id, grid_id, method, distance_km).

### analytics — views (materialize only when measured slow)

`v_coverage_by_area` (township and ZIP) · `v_year_built_distribution` · `v_sqft_distribution` ·
`v_heating_central_air` · `v_missing_fields` · `v_degree_days_monthly` (with normals) · `v_weather_vs_demand`, which
is **designed but not created** until a `business.demand_daily` table exists. Business data will live in its own schema
with stricter RLS. That view pairs weather with calls and labels its output as correlation only.

## 4. Import-job lifecycle

```
pending ──claim──▶ running ──all batches staged──▶ validating ──gates pass──▶ publishing ──commit──▶ completed
   ▲                  │  │                             │  └─ dry_run: gates evaluated ──────────────▶ completed (nothing published)
   │                  │  └─ error ▶ failed ◀────────────┴── gate fails / publish error (published data untouched)
   │  retry (op/admin) │
   └──── failed ───────┘      any non-terminal ──cancel──▶ cancel_requested ──runner acknowledges──▶ cancelled
```

- Transitions are defined once (`packages/property-data/src/jobs/state-machine.ts`) and enforced twice: in
  `ImportService`, and by a Postgres trigger that rejects illegal status changes.
- **Claim**: `ingestion.claim_job(worker_id, capabilities, lease_seconds)` does `FOR UPDATE SKIP LOCKED` on the oldest
  `pending` job the worker can run (an office-only job is never claimed by a cloud worker). It sets the lease. The worker
  heartbeats; an expired lease makes the job reclaimable, and the next claim resumes from `checkpoint`.
- **Checkpoint** after every batch: `{dataset, offset, lastParcelId, batchSeq}`. Batches are idempotent by
  `(job_id, dataset, seq)`, so replaying a batch after a crash is safe.
- **Cancel**: the API sets `cancel_requested`. The runner checks between batches and on `AbortSignal`, then stops and
  marks the job `cancelled`. Staged rows are discarded.
- **Retry**: `failed` or `cancelled` → `pending` with `retry_count + 1`, resuming from the checkpoint. At `max_retries`
  (default 3) the job is `dead_lettered = true` and an alert fires (§8). It can be requeued manually by an admin, with an
  audit event.
- **Dry run**: fetch, snapshot, stage, validate, report, then `completed` without calling publish. Published tables are
  untouched; the job-detail screen shows what *would* have been inserted or updated.

## 5. Execution modes (same job table, same service, three hosts)

| Mode | When | How it authenticates |
|---|---|---|
| **Office agent** (primary for Cook) | Cook blocks datacenter IPs (DATA-SOURCES.md), so imports run from a machine on ARR's network. It's `npm run property:worker` as a Windows service or scheduled task. | A dedicated `ingestion_runner` Postgres role (ingestion + staging + publish function only; **not** `service_role`) and an R2 token scoped to one bucket, kept in the machine's credential store. Outbound HTTPS only; no inbound ports. |
| **Cloud worker** (later) | Sources that allow datacenter egress: NOAA, NWS, possibly Cook if that changes. | Same role, as a Worker secret. It only claims `runner_requirement = 'any'` jobs. |
| **CLI** (recovery and dev) | `npm run property:import -- --source cook --area-type township --area Orland --mode dry-run --limit 100` | Local: in-memory store and filesystem snapshots, no credentials. Staging and prod: the runner role. The CLI **creates a job and runs it through `ImportService`**, the same code path the Hub triggers. |

## 6. Validation gates (run on staged rows; any blocking failure ⇒ nothing is published)

| Rule | Effect |
|---|---|
| Missing parcel id | Row rejected |
| Duplicate parcel id within the job | Row rejected (the first is kept); issue raised |
| Source year ≠ job source_year | Batch rejected |
| Invalid ZIP (not 5 digits, or outside the jurisdiction's allowlist) | Row accepted with ZIP nulled; issue raised |
| Implausible year built (< 1800 or > next year) | Field nulled; issue raised |
| Implausible sqft (< 300 or > 15,000) | Field nulled; issue raised |
| Address normalization failure | Row accepted (identity is the PIN); issue raised; no address row |
| Duplicate normalized address across PINs | Issue only (condos and multi-PIN lots are legitimate) |
| Multi-card parcel | All cards stored; primary = lowest card; low-severity issue |
| **Unexpected count reduction** (> 10 % below last published for the same area and dataset) | **Blocks publish** (`COUNT_DROP`) |
| **Reject rate** above threshold (default 2 %) | **Blocks publish** (`REJECT_RATE`) |

Thresholds live in code with defaults and a per-job override field. Overrides are admin-only and audited (later
phase). Publishing is a single SQL function, `ingestion.publish_job(job_id)`, run in one transaction. It upserts
properties and addresses, inserts new versions and facts idempotently, and recomputes coverage. If it fails, the whole
transaction rolls back and the previous dataset is exactly as it was.

## 7. Environments

| | Local | Staging | Production |
|---|---|---|---|
| Hub data | `DATA_SOURCE=mock` (today), or `memory` (jobs work end to end in one process), or `supabase` against local Supabase | Supabase staging project | Supabase production project |
| Database | None (memory), or **Supabase CLI local** (Docker, PostGIS included) | `arr-hub-staging` | `arr-hub-prod` (Pro tier: the free tier's 500 MB won't hold ~250k parcels with versions and facts) |
| Snapshots | `.data/snapshots/` (gitignored) | R2 `arr-property-snapshots-staging` | R2 `arr-property-snapshots` |
| Runner | CLI, in-process | Office agent (staging role) | Office agent (prod role) |
| Auth | Stub user with a selectable role (dev only; refuses to run when `NODE_ENV=production`) | Supabase Auth, MFA optional | Supabase Auth, **MFA (AAL2) required** for operator and admin |

Hub hosting for staging and prod is undecided. Webflow Cloud is the wrong home for an authenticated internal tool. The
likely choice is its own Cloudflare Worker behind Cloudflare Access *and* Supabase Auth. That's decided at Phase C.

## 8. Authentication, authorization, security

- **Roles:** viewer (read) · analyst (+ sales, exports within limits) · operator (+ start, cancel and retry imports) ·
  admin (+ projects, API clients, manual overrides, role grants, dead-letter requeue).
- **Enforced twice:** `authorize(user, action)` in `packages/property-data` (unit-tested for every role × action), and
  RLS in Postgres (SQL-tested). Operator and admin write policies also require `auth.jwt()->>'aal' = 'aal2'` in
  production.
- **Secrets:** the browser gets the anon key and the user's session only. `service_role` is used by nothing in this
  design. The runner has its own least-privilege role. `.env.example` files document every variable with no values.
- **PII boundary:** this database holds public-record property data only. Leads, customer names, phones and emails stay
  in the pricing app's `LEADS` KV, Monday and Sera. They're never joined into these schemas. `business.*` demand data
  (later) is aggregate counts, not people.
- **Public endpoints never return** PINs, sale prices, raw snapshots or bulk exports (§9).
- **Input handling:** job definitions are zod-validated. Every enum (source, jurisdiction, area type, mode, dataset) and
  every area value comes from the server catalog, so no browser string ever reaches a SoQL query. The Cook connector
  builds queries only from catalog values and escapes them anyway.

## 9. Pricing-app migration (no production change in this phase)

1. Load and validate the property database (staging, then prod).
2. Add `apps/property-api`: `GET /v1/lookup?addr=` → sizing facts only (sqft, year built, stories, style, central air,
   basement, heating, last HVAC-permit year, county, source, as-of). **No PIN, no sale price.**
3. **Shadow mode:** the pricing Worker calls the new API *in addition* to its current path, logs field-level diffs, and
   serves the old answer.
4. Investigate diffs: normalization, card choice, year vintages.
5. Put KV in front of the new API as a read cache (same TTL policy as today).
6. Switch production reads, behind a flag, with instant rollback.
7. The three-question fallback stays for every miss, Will County and every error.

**Exposure found during this review (not changed; needs a decision):** today `/api/lookup` returns `pin`, and for live
Cook lookups `sale.price`, in its public JSON. The widget shows the PIN on the record plate by design and never renders
the sale price. CLAUDE.md says sale price must never reach the page, and this brief says PINs shouldn't be exposed by
pricing endpoints. The new API won't return either. Whether the plate keeps showing the PIN is a product call.

## 10. Weather-data strategy

A weather area is a station plus an NWS grid cell. `area_station_mapping` ties townships and ZIPs to it, and a property
reaches weather through its ZIP or township. Daily history comes from NOAA NCEI GHCN-Daily. The NCEI Access Data
Service may avoid the CDO token; confirm before building. Forecasts and alerts come from `api.weather.gov` (User-Agent
required). Both are ordinary jobs (`source = noaa-ghcnd | nws`, `runner_requirement = any`), so they run in a cloud
worker. HDD and CDD are computed at ingest on NOAA's 65 °F base; normals are loaded once per station.

## 11. Reliability and observability

- **Structured logs:** one JSON line per event with `job_id`, `batch_id`, `worker_id`, `code` and `ms`, written to
  `ingestion.job_events` and stdout.
- **Metrics** (derived from job and batch rows; no metrics vendor yet): duration, rows/sec, reject rate, source error
  rate, retries.
- **Stale coverage:** `v_coverage_by_area` flags areas past the freshness threshold. The Hub already renders this state.
- **Alerts interface:** `AlertSink` with `notifyFailedJob` / `notifyDeadLetter` / `notifyStaleCoverage`. Log-only now;
  email or Monday later.
- **Health:** Hub `/api/health` (liveness) and `/api/ready` (repo reachable, last runner heartbeat age).
- **Suggested objectives (not yet measured, not claimed):** a monthly Cook refresh finishes within 4 hours of being
  queued; ≥ 98 % of rows accepted; no area stale beyond 45 days; a failed job is visible in the Hub within 5 minutes.
- **Backups:** Supabase daily backups (Pro), plus PITR if enabled. Restores are practised on staging once per quarter.
  Raw snapshots in R2 are the second line: any published state can be rebuilt by replaying them.
- **Snapshot retention:** keep everything from the current and prior source year. Older snapshots are thinned to one
  full set per source year. Nothing is deleted while a published version references it.
- **Runbooks to write** (in RUNBOOK.md): failed import; blocked source access (Cook returns 403 or timeouts from the
  agent); dead-lettered job; restoring from snapshot; rotating the runner credential.

## 12. Operational risks

| Risk | Mitigation |
|---|---|
| **Cook County blocks datacenter traffic** (confirmed 2026-09-21) | The office agent is the primary Cook runner. Jobs carry `runner_requirement = office`. The CLI is the fallback. Blocked-access runbook. |
| The office machine sleeps, reboots or loses network | Leases expire and the job is reclaimed and resumes from its checkpoint. A stale runner heartbeat shows in `/api/ready` and the Hub. |
| Cook changes dataset years or schema (2023 parcels, 2024 chars are hard-coded today) | source_year is a job parameter validated against the connector's supported years. A schema drift check runs on the first page of each dataset; unexpected columns fail the batch. |
| Rate limiting or throttling by Socrata | Token-bucket limiter, exponential backoff with jitter, page-size control, resumable checkpoints. |
| Normalization drift between pricing and the database | One `normalize.ts`, shared. The shadow comparison (§9) measures it before any switch. |
| Database size or cost | Pro tier for prod; staging tables purged after publish; versions store a compact projection, not raw rows. |
| Accidental PII mixing | Schema boundary (§8), no lead tables, code-review checklist item. |
| Will County gap | Explicit unsupported connector; the Hub shows "not available" rather than 0 %. |

## 13. Phased delivery

| Phase | Scope | Needs |
|---|---|---|
| **A — foundation (proposed for approval now)** | Migrations and SQL tests (written, not applied to any cloud); `packages/property-data` (types, schemas, catalog, state machine, authz, repositories, in-memory adapters, Postgres adapter scaffold, filesystem and R2 snapshot adapters, ImportService, validation gates); Cook connector refactor with `extract-cook.ts` output kept identical; `apps/property-ingestion` CLI + worker (memory store; dry run end to end against the real Cook source from this machine); Hub `/api/import-jobs*` + New Import + job detail on the memory store; tests from the definition of done. | No accounts. New npm deps: `zod`, `postgres`, `@supabase/supabase-js`, `aws4fetch`. |
| **B — local database** | Supabase CLI local (Docker); Postgres adapter implemented; RLS and SQL tests run in CI against a `postgis/postgis` service container; full and incremental imports publishing locally; Hub on `DATA_SOURCE=supabase` locally. | Docker Desktop on the dev machine. |
| **C — staging** *(approval required)* | Provision the Supabase staging project, R2 staging bucket, Auth + MFA and the runner role; install the office agent; first real Cook import to staging; decide Hub hosting. | Accounts, secrets, office machine. |
| **D — Property Data API + shadow** | `apps/property-api`; shadow comparison in pricing (logging only); KV cache. | Staging data. |
| **E — cut-over and breadth** *(approval required)* | Switch pricing reads behind a flag; weather ingestion; Sera demand; production. | Sign-off on the diff report. |
