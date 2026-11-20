# ARR Intelligence Hub

ARR Heating + Cooling's internal property, market, weather and ingestion dashboard. It answers six questions:

- What property information do we have?
- Where is coverage incomplete or stale?
- What kinds of homes are in each market?
- Which areas have older homes, and so likely older HVAC systems?
- How are heat, cold and severe weather lining up with demand?
- What should we download or refresh next?
- Where does ARR show up when homeowners ask Google, Google Maps and AI assistants for HVAC help?

**Status: v1 shell.** Every page runs on typed **mock data** behind repository interfaces. There is **no production
authentication** and **no database write**. A yellow banner on every page says both. Don't deploy it anywhere reachable
until Supabase Auth is in (see [Connecting Supabase](#connecting-supabase)).

This is ARR's central internal tool hub, kept in its own repository. It used to live in the pricing app's monorepo
(`alwaysreadyrepairhvac/arr_instant_pricing`, `apps/intelligence-hub`) and shares no code with it. The pricing app
is one of the Hub's data consumers (see `/projects`).

## Local development

Node ≥ 22.23.4 (Astro 7's floor; `.nvmrc` pins Node 22, so `nvm use` picks it up):

```bash
npm install
npm run dev      # http://localhost:4322 (Astro 7 runs it in the background: `npx astro dev stop` / `status` / `logs`)
npm run test     # lib + mock-repository tests (node --test)
npm run check    # astro check (types)
npm run build    # production build (Cloudflare adapter, deploys as a Worker)
npm run preview  # serve the build in workerd
```

`dev`, `check` and `build` first run `npm run types` (`wrangler types`), which generates the `Env` type from
`wrangler.json` into `worker-configuration.d.ts` (git-ignored). Server code reads bindings and vars with
`import { env } from 'cloudflare:workers'`; `Astro.locals.runtime` no longer exists.

**Reviewing data states.** In mock mode, append `?simulate=error`, `?simulate=empty` or `?simulate=slow` to any URL to
force that state on every panel. Stale data needs no simulating: the mock Lyons and Worth townships are deliberately
months old, and Will County has never been ingested.

## Routes

| Route | Answers |
|---|---|
| `/` | Overview: KPIs, territory map, housing profile, weather vs. demand, coverage freshness, jobs, quality alerts, activity |
| `/properties` | Search by address/PIN; filter by ZIP, township, year built, sq ft, stories, heating, central air, basement, last HVAC permit, source |
| `/properties/[id]` | One home: facts, manual overrides, source-release history, permits, sales (internal), weather area |
| `/markets` | Housing stock by territory: age, size, heating, central air, "older homes with no recent permit" (inputs shown), territory comparison, trends (empty until 2+ snapshots) |
| `/weather` | HDD/CDD vs. 1991–2020 normal, extreme days, freeze events, precip/snow, NWS alerts, 7-day forecast, daily temps, weather vs. demand |
| `/coverage` | Coverage by ZIP or township: completeness, freshness, missing-field rates, source year, "Refresh area" → import planner |
| `/imports` | Ingestion jobs: progress, accepted/rejected counts, rejected samples, errors. Controls are read-only in v1. |
| `/imports/new` | Import wizard: county → areas → coverage preview → dry run → start. Steps 1–3 work; dry run and start are disabled. |
| `/quality` | Review queue: duplicates, address-match failures, missing sq ft / year, implausible values, large release-to-release changes |
| `/projects` | API consumers: datasets, territories, key prefix, usage, rate limits, audit history |
| `/seo` | SEO & AEO overview: AI answers naming ARR, Google top-3 share, map-pack share, site issues, biggest rank moves, refresh cost |
| `/seo/ai` | AEO: each prompt × engine (ChatGPT, Perplexity, Gemini, Google AI Overview): named / cited / not named, the answers, weekly history, who gets named instead, which sites AI cites |
| `/seo/search-console` | Google Search Console: real clicks, impressions, click rate and position for the last 28 days vs the 28 before; weekly clicks over 16 months; brand vs non-brand vs hidden; tracked keywords measured; closest wins (position 4–20); top search terms and pages |
| `/seo/rankings` | Google organic position per keyword × city, change since last refresh, who ranks above us, SERP features; filter by city and service |
| `/seo/local` | Map-pack grid: a heatmap of ARR's Google Maps position from evenly spaced points over the whole service area, who is listed first, top-3 points per refresh and per city; plus position from each city centre and the three businesses holding the map pack |
| `/seo/keywords` | Chicago-market search volume, CPC, competition and 12-month seasonality for the tracked keywords |
| `/seo/competitors` | Discovered competitors: appearances in our searches, keywords ranked, est. traffic, referring domains |
| `/seo/audit` | Crawl of alwaysreadyrepair.com: findings by severity (AEO-tagged), AI-crawler access, llms.txt, schema coverage, per-page detail |

Global filters (territory, date range, data source) live in the query string, so every view is linkable and works
without JavaScript. `href()` in `src/lib/filters.ts` carries them between pages.

## Architecture

```
src/
  domain/types.ts          Domain models (Property, PropertyVersion, CoverageArea, WeatherObservation,
                           WeatherForecast, IngestionJob, DataQualityIssue, Project, AuditEvent, DemandMetric, …)
  repositories/
    types.ts               Repository interfaces: the only way pages reach data
    index.ts               getRepositories(env): picks mock / supabase from DATA_SOURCE
    mock/                  In-memory implementations over the mock dataset (+ tests)
  data/mock/               Deterministic synthetic dataset. Imported ONLY by repositories/mock
  lib/                     Pure helpers: load() states, freshness, filters, stats, chart geometry, weather stress
  middleware.ts            Attaches user (stub), repos, request clock, ?simulate to Astro.locals
  components/
    layout/Shell.astro     Sidebar, filter bar, banners, shared chart tooltip
    ui/                    Panel (owns ok/empty/error/stale), Kpi, Status, Skeleton, Icon
    charts/                Server-rendered SVG: Columns, Lines, BarList, Share (no chart library)
    map/TerritoryMap.astro Schematic ZIP-tile map (placeholder for a real basemap)
    panels/                Self-loading panels used as server islands (WeatherDemand)
  pages/                   One file per route (pages/seo/* for SEO & AEO)
  domain/seo.ts            SEO & AEO models (RankObservation, LocalPackResult, AiAnswer, SiteAudit, SeoSnapshot, …)
  data/seo/targets.ts      What the SEO refresh tracks: cities, keywords, AI prompts, engines, non-competitor domains
  lib/seo/                 Pure SEO helpers: roll-ups (stats), AI-answer matching (match), DataForSEO client + parsers
                           (dataforseo), page/robots/sitemap checks (audit)
  repositories/seo.ts      The SEO repository over one SeoSnapshot (mock or KV)
scripts/seo-refresh.ts     Collects the SEO snapshot: DataForSEO calls + a free crawl of the site
```

**Three data families, kept apart.** They come from different systems, refresh on different clocks and answer
different questions:

1. **Property facts** (`Property`, `PropertyVersion`, `CoverageArea`) come from county assessor and permit records.
2. **Weather** (`WeatherObservation`, `WeatherNormal`, `WeatherForecast`, `WeatherAlert`) is stored **once per
   `WeatherArea`** (a NOAA station plus an NWS grid cell). A property carries only `weatherAreaId` and never a copy of
   the weather.
3. **Business demand** (`DemandMetric`) is ARR's calls and leads, from Sera. It is never written onto property or
   weather records.

**Every panel has four states.** Pages call repositories through `load()` (`src/lib/load.ts`), which returns
`ok | stale | empty | error`. `Panel.astro` renders each one. Stale data stays visible under a warning with its age.
Errors show the message and a retry link, so a failing panel never takes down the page. **Loading** is real: the
weather-vs-demand panel is an Astro server island (`server:defer`) whose `Skeleton` fallback shows while it loads.

**Attribution everywhere.** Every data panel footer names its source and says how old the data is. Freshness
thresholds live in one place (`STALE_AFTER_DAYS` in `src/lib/freshness.ts`).

**Honesty rules baked into the UI:**
- No opportunity score. Markets shows a count with its inputs (built before X, no HVAC permit since Y), states that
  it isn't a confirmed equipment age, and links to the matching homes.
- Weather vs. demand reports Pearson r as **correlation** and says it doesn't show causation. It uses two charts on a
  shared time axis, never a dual y-axis.
- "Weather stress" shows its inputs (7-day HDD/CDD vs. the normal for the same days).
- Sale prices are labelled internal-only.

**Charts.** Server-rendered SVG with a shared tooltip (`[data-tip]`), a "View as table" disclosure on every chart,
fixed-order categorical colours checked with the dataviz palette validator against the panel surface, and status
colours reserved for status. Tokens are in `src/styles/global.css`.

**Visual system.** A quiet dark operations-room theme on the ARR palette, polished after a study of calm, status-led
product UIs:
- **Depth from a flat surface ladder** (`--bg-0` sidebar → `--bg` page → `--surface-1` card → `--surface-2` raised →
  `--surface-3` selected), never from panel shadows or gradients. A faint plotting grid sits on the page canvas only.
- **Colour means something.** ARR light blue `#03bce6` for data, focus and the active-nav bar; ARR red, deepened to
  `#d0222a` so white text passes 4.5:1, only for the one primary action and critical states; yellow only for warnings
  and the classification strip. Status pills are a 15% tint of their colour with an icon and a label.
- **The intelligence character comes from type.** Inter for text and numbers; IBM Plex Mono, uppercase, for panel
  titles, labels, codes, IDs and timestamps. Five sizes (12/13/14/16/24, plus 28 for KPIs), three radii (6/10/pill).
- **One targeting motif:** corner brackets (`Panel feature`) on a page's hero element, the territory map.
- Page navigation is underline tabs; filters are chips. Empty states show ghost rows and one sentence.

## SEO & AEO

The `/seo` pages answer where ARR shows up in Google, Google Maps and AI assistants. It's the Hub's fourth data family:
it comes from search and answer engines plus a crawl of our own site, refreshes weekly, and never touches property,
weather or demand records. It has **its own source switch**, `SEO_DATA_SOURCE`, so it can be real while the
property data is still mock:

| `SEO_DATA_SOURCE` | Pages read | Banner |
|---|---|---|
| `mock` (default) | A deterministic synthetic snapshot built from the real targets, with invented `.example` competitors | Mock data |
| `snapshot` | The `seo:snapshot` key in the `SEO` KV namespace | none; each panel shows how old the data is |

**Refreshing (weekly).** Browsing never spends money. Only the refresh script calls DataForSEO:

```bash
npm run seo:refresh -- --dry-run      # steps, paid call count, rough cost (~$1.80 at list prices)
npm run seo:refresh -- --only=audit   # the free site crawl only, no key needed
npm run seo:refresh -- --only=search-console   # Google Search Console only, free; needs GSC_SERVICE_ACCOUNT
npm run seo:refresh -- --sandbox      # DataForSEO's free sandbox: checks credentials and request shapes
npm run seo:refresh                   # everything: audit, search-console, rankings, local, grid, ai, keywords, competitors
npm run seo:load                      # copy .seo/snapshot.json into the local SEO KV
```

Then run the Hub with `SEO_DATA_SOURCE=snapshot` (put it in `.dev.vars`). Credentials go in
`.env`: `DATAFORSEO_LOGIN` and `DATAFORSEO_PASSWORD` (the API password from the API Access
page), or OpenSEO's `DATAFORSEO_API_KEY` (base64 of `login:password`). A step that fails is reported and skipped,
and the previous refresh's data for it is kept. The snapshot keeps the last 26 refreshes as history.

**What each step does.**
- `audit` (free): robots.txt (AI crawlers blocked?), sitemap, `/llms.txt`, then every sitemap page: title, meta
  description, H1, word count, canonical, noindex, JSON-LD types, FAQ content without FAQPage schema, images without
  alt text, duplicate titles. Findings that matter mostly to AI engines are tagged AEO.
- `search-console` (free): Google Search Console for `GSC_PROPERTY` (`sc-domain:alwaysreadyrepair.com` by default):
  16 months of clicks and impressions by day, plus search terms and pages for the last 28 days and the 28 before.
  Setup, once: create a service account in Google Cloud, enable the Search Console API, download its JSON key, and
  add the account's `client_email` as a user (Restricted is enough) on the property in Search Console. Then set
  `GSC_SERVICE_ACCOUNT` in `.env` to the key's path (or its JSON). Without it a full refresh skips this step and
  keeps the last data; `GSC_PROPERTY` overrides the property, e.g. `https://www.alwaysreadyrepair.com/` for a
  URL-prefix property. Unlike the other steps it isn't merged with history, because Google keeps 16 months itself.
- `rankings`: Google organic for every keyword × city, searched from that city, `RANK_DEPTH` results deep. It also
  records SERP features and whether we're in the local pack.
- `local`: Google Maps from each city centre for `LOCAL_KEYWORDS`.
- `grid`: Google Maps from every point of one grid over the service area (`GRID` in `targets.ts`: the cities'
  bounding box plus a margin, 2 miles apart, map zoom 14), for `GRID.keywords`. With today's cities that's 54
  points × 2 keywords = 108 calls, about $0.43 a run. One shared grid, so neighbouring cities don't pay twice.
- `ai`: every prompt to ChatGPT, Perplexity and Gemini (DataForSEO LLM Responses, web search on) and as a Google
  search for its AI Overview. Each answer is matched for ARR and competitor names and citations. Model names come
  from DataForSEO's free catalog first, because an unknown model name fails as a *billed* task.
  Claude is tracked too. With `OPENAI_API_KEY` in `.env`, ChatGPT is asked straight through OpenAI's Responses API,
  and with `ANTHROPIC_API_KEY` Claude is asked straight through the Anthropic API (Claude Opus 5.5, web search,
  server-side fallback to another Claude model if it declines). Both place the web search in Orland Park; models
  are in `AI_DIRECT` or `OPENAI_MODEL` / `ANTHROPIC_MODEL`. Each answer's cost is priced from its tokens and
  searches at the list prices in `AI_DIRECT`. The answer card on `/seo/ai` says
  which API and model answered.
- `keywords`: Google Ads volume, CPC and monthly history for the Chicago market.
- `competitors`: the domains that show up most in our top-10 results, minus directories (`NOT_COMPETITORS`), profiled
  with DataForSEO Labs and the backlinks index.

**Honesty rules.** No blended "SEO score": every figure is a count with its denominator. AI share leaves unanswered
checks out of the denominator and says so. Traffic is labelled as DataForSEO's estimate. Prompts are unbranded,
because a prompt that names ARR only tests whether the engine can repeat it.

**Ported code.** `src/lib/seo/match.ts` and `src/lib/seo/dataforseo.ts` are rewritten from
[OpenSEO](https://github.com/every-app/open-seo) (MIT). See `THIRD_PARTY_NOTICES.md`. OpenSEO's app itself (React,
D1, Workflows, accounts, billing, MCP) is not part of the Hub.

## Connecting Supabase

The swap is one directory plus the factory. Pages and components don't change.

1. **Schema.** One table per domain model, matching `src/domain/types.ts` (snake_case columns). Suggested:
   `properties`, `property_versions`, `permits`, `sales`, `manual_overrides`, `coverage_areas`, `weather_areas`,
   `weather_observations` (PK `area_id, date`), `weather_normals`, `weather_forecasts`, `weather_alerts`,
   `demand_daily`, `ingestion_jobs`, `ingestion_rejections`, `quality_issues`, `projects`, `project_usage_daily`,
   `audit_events`.
2. **Aggregates in SQL, not JS.** `MarketRepository.profile / compareTerritories / countByAgeAndPermit` and the coverage
   rollups become views or RPCs (`percentile_cont` for medians, `date_trunc` for decades), so nothing reduces 250k
   rows in a Worker.
3. **Implement `src/repositories/supabase/`.** One class per interface in `repositories/types.ts`. Use
   `@supabase/server` / `@supabase/supabase-js` with the publishable key and row-level security. Keep the secret
   key (`sb_secret_…`, the old `service_role`) out of the Worker.
4. **Wire the factory.** In `repositories/index.ts`, return the Supabase repositories when `DATA_SOURCE=supabase`.
   Until then, that setting makes every panel show an error rather than quietly falling back to mock numbers.
5. **Auth.** Replace `DEV_USER` in `src/middleware.ts` with a Supabase Auth session check (redirect to sign-in when
   missing) and drop the "No authentication" banner, which keys off `user.stub`.
6. **Mutations come last**, each behind auth and an `audit_events` insert: start/retry/cancel import, resolve/ignore
   quality issue, rotate project key. The buttons exist today and are disabled.
7. Run the mock repository tests against the Supabase repositories as a contract test, then point `DATA_SOURCE` at
   Supabase.

Env (`wrangler.json` vars / `.dev.vars` locally): `DATA_SOURCE`, `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`,
`SUPABASE_JWKS_URL` (Auth JWT verification for `@supabase/server`).

**External sources to wire behind the same interfaces:**
- Weather history: NOAA NCEI (Climate Data Online / GHCN-Daily). Needs a token and has request limits.
- Forecasts and alerts: the National Weather Service API (`api.weather.gov`, grid forecasts). The pricing app already
  proxies it server-side in `/api/weather`.
- Demand: Sera (AppointmentsReport / OpportunitiesReport exports until there's an API).
- Property: the Cook County Assessor bulk extract (`npm run county:extract`, from a laptop, since Cook blocks
  datacenter IPs). DuPage and Will need sources. The Will lookup is still a stub in the pricing app.

## Known placeholders

- `weatherAreas` station and grid ids in `src/data/mock/dataset.ts` are unverified. Resolve the real NWS grid with
  `api.weather.gov/points/{lat},{lon}` before wiring the NWS repository.
- The territory map is a schematic tile grid. Replace it with MapLibre and ZIP polygons, keeping the same props.
- Trends need a monthly snapshot job. The panel shows its empty state until two snapshots exist.
- Not built yet (needs Sera data): replacement sales by home age, failure rates, average ticket by ZIP, and
  weather event → lead → appointment → sale conversion.
