# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

ARR Intelligence Hub: ARR Heating + Cooling's central internal tool hub. Property, market, weather, ingestion and SEO/AEO dashboards. Not deployed anywhere yet. `README.md` is the reference; `docs/INTELLIGENCE-HUB-DATA-PLATFORM.md` and `docs/adr/` hold the Phase 2 property-data plan.

It was split out of the pricing app's monorepo (`alwaysreadyrepairhvac/arr_instant_pricing`, `apps/intelligence-hub`) and shares no code with it. The county connectors, address normalizer and Supabase loaders the Phase 2 doc mentions still live in that repo.

## Commands

Node ≥ 22.

```
npm install
npm run dev        # http://localhost:4322
npm test           # node --test over src/**/*.test.ts
npm run check      # astro check (types)
npm run build      # Astro build, Cloudflare adapter
npm run seo:refresh -- --dry-run   # SEO & AEO refresh plan and cost; drop --dry-run to run it
npm run seo:load                   # load .seo/snapshot.json into the local SEO KV
```

## Architecture

- Astro SSR on the Cloudflare adapter. Server-rendered; global filters live in the query string, so pages work without JS.
- v1 runs on mock data (`src/data/mock/`), which **only** `src/repositories/mock/` may import. Pages reach data through `Astro.locals.repos` (interfaces in `src/repositories/types.ts`) wrapped in `load()`, and `Panel.astro` renders ok/stale/empty/error. `?simulate=error|empty|slow` forces states in mock mode.
- Property facts, weather (stored per `WeatherArea`, never on a property), Sera demand and SEO stay in separate models.
- **SEO & AEO tab (`/seo/*`)** has its own source switch, `SEO_DATA_SOURCE=mock|snapshot`, independent of `DATA_SOURCE`. Both build one `SeoSnapshot` (`src/domain/seo.ts`); snapshot mode reads it from the `SEO` KV key `seo:snapshot`, written by `npm run seo:refresh` (DataForSEO + a free crawl of the site) and `npm run seo:load`. Pages never call DataForSEO, so browsing costs nothing. Targets (cities, keywords, AI prompts) are data in `src/data/seo/targets.ts`; competitors are discovered from the rank results, and mock competitors use `.example` domains. `src/lib/seo/match.ts` and `dataforseo.ts` are ported from OpenSEO (MIT, see `THIRD_PARTY_NOTICES.md`); billed DataForSEO calls are never retried.
- No production auth (a stub `DEV_USER` in `src/middleware.ts`) and no mutations. Controls that would write are rendered disabled. `DATA_SOURCE=supabase` deliberately makes every panel error until the Supabase repositories exist.
- Charts are server-rendered SVG (`src/components/charts/`), no chart library. Tokens in `src/styles/global.css`.
- Anything customer-facing must follow the ARR brand: load the `arr-bible`/`arr-brand` skills.
