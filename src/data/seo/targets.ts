/* What the SEO/AEO refresh tracks for ARR. Company facts, so they live in data, not in the pages.
 *
 * Changing a list changes what the next `npm run seo:refresh` pays for: every keyword is searched in every
 * market (organic), LOCAL_KEYWORDS are also searched on Google Maps in every market, and every prompt is asked of
 * every engine. `--dry-run` prints the call count and an estimate before anything is spent.
 *
 * Competitors are not listed here. The refresh discovers them from who actually shows up in the tracked searches,
 * minus the directories below, so the list can't drift from reality. */

import type { AiEngine, AiPrompt, SeoBrand, SeoMarket, TrackedKeyword } from '../../domain/seo.ts';

export const SITE_DOMAIN = 'alwaysreadyrepair.com';

/** The Search Console property the refresh reads. A Domain property covers www and every protocol; use the
 *  `https://www.alwaysreadyrepair.com/` form instead if only a URL-prefix property is verified. GSC_PROPERTY in the
 *  environment overrides it. */
export const GSC_PROPERTY = `sc-domain:${SITE_DOMAIN}`;
/** The comparison window on the Search Console tab, in days. */
export const GSC_WINDOW_DAYS = 28;

export const BRAND: SeoBrand = {
  domain: SITE_DOMAIN,
  name: 'ARR Heating + Cooling',
  // Plain "ARR" is left out on purpose: it matches too much that isn't us.
  names: ['ARR Heating + Cooling', 'ARR Heating & Cooling', 'ARR Heating and Cooling', 'ARR HVAC', 'Always Ready Repair'],
  own: true
};

export const MARKETS: SeoMarket[] = [
  { id: 'orland-park', city: 'Orland Park', locationName: 'Orland Park,Illinois,United States', lat: 41.6303, lon: -87.8539 },
  { id: 'tinley-park', city: 'Tinley Park', locationName: 'Tinley Park,Illinois,United States', lat: 41.5731, lon: -87.7845 },
  { id: 'palos-heights', city: 'Palos Heights', locationName: 'Palos Heights,Illinois,United States', lat: 41.6681, lon: -87.7964 },
  { id: 'oak-lawn', city: 'Oak Lawn', locationName: 'Oak Lawn,Illinois,United States', lat: 41.7109, lon: -87.7581 },
  { id: 'homer-glen', city: 'Homer Glen', locationName: 'Homer Glen,Illinois,United States', lat: 41.6, lon: -87.9381 },
  { id: 'mokena', city: 'Mokena', locationName: 'Mokena,Illinois,United States', lat: 41.5261, lon: -87.8892 },
  { id: 'frankfort', city: 'Frankfort', locationName: 'Frankfort,Illinois,United States', lat: 41.4959, lon: -87.8487 }
];

export const KEYWORDS: TrackedKeyword[] = [
  { keyword: 'furnace repair', service: 'furnace' },
  { keyword: 'furnace replacement', service: 'furnace' },
  { keyword: 'furnace installation', service: 'furnace' },
  { keyword: 'furnace tune up', service: 'maintenance' },
  { keyword: 'ac repair', service: 'ac' },
  { keyword: 'ac replacement', service: 'ac' },
  { keyword: 'air conditioner installation', service: 'ac' },
  { keyword: 'heat pump installation', service: 'heat-pump' },
  { keyword: 'boiler repair', service: 'boiler' },
  { keyword: 'emergency hvac repair', service: 'emergency' },
  { keyword: 'hvac company', service: 'general' },
  { keyword: 'hvac repair', service: 'general' }
];

/** Also checked on Google Maps in every market. The map pack is where most local service calls start. */
export const LOCAL_KEYWORDS = ['hvac company', 'furnace repair', 'ac repair', 'furnace replacement'];

/** The map-pack grid: Google Maps searched from evenly spaced points over the whole service area (the tracked
 *  cities' bounding box plus `marginMiles`), not just each city centre. Calls per refresh = points × keywords; with
 *  the cities above, 2-mile spacing gives 54 points. `zoom` is the map zoom DataForSEO searches at (14 ≈ a few
 *  miles across, close to what a phone shows). */
export const GRID = { keywords: ['hvac company', 'furnace repair'], spacingMiles: 2, marginMiles: 1, zoom: 14 };

/** Unbranded questions. A prompt that names ARR would only measure whether the engine can echo it back. */
export const PROMPTS: AiPrompt[] = [
  { id: 'best-hvac-orland', text: 'Who is the best HVAC company in Orland Park, IL?', service: 'general' },
  { id: 'furnace-cost-south-suburbs', text: 'How much does a new furnace cost in the south suburbs of Chicago, and who has upfront pricing?', service: 'furnace' },
  { id: 'upfront-pricing-tinley', text: 'Which heating and cooling companies near Tinley Park, IL show their prices online?', service: 'general' },
  { id: 'furnace-out-oak-lawn', text: 'My furnace stopped working in Oak Lawn, IL. Who can come out today?', service: 'emergency' },
  { id: 'ac-replace-palos', text: 'Best company to replace central air conditioning in Palos Heights, IL', service: 'ac' },
  { id: 'heat-pump-chicago-suburbs', text: 'Is a heat pump worth it in the Chicago suburbs, and who installs them near Orland Park?', service: 'heat-pump' },
  { id: 'boiler-homer-glen', text: 'Who services and repairs boilers near Homer Glen, IL?', service: 'boiler' },
  { id: 'maintenance-plan-mokena', text: 'Which HVAC companies near Mokena, IL offer a good maintenance plan?', service: 'maintenance' }
];

export const ENGINES: AiEngine[] = ['chatgpt', 'claude', 'perplexity', 'gemini', 'google_ai_overview'];

/** Engines the refresh asks straight through their own API when credentials are in the environment
 *  (OPENAI_API_KEY for ChatGPT, ANTHROPIC_API_KEY for Claude), instead of through DataForSEO. Direct calls run the
 *  web search from AI_SEARCH_LOCATION, so the answer reflects what a homeowner here would get. OPENAI_MODEL and
 *  ANTHROPIC_MODEL override the models; effort is kept low because these are quick consumer questions.
 *  Prices are list prices used to record what each answer cost: check them against the provider's pricing page when
 *  you change the model (the gpt-5.5 figures are an assumption carried over from gpt-5). */
export const AI_DIRECT = {
  chatgpt: { model: 'gpt-5.5', effort: 'low', price: { inputPerMTok: 1.25, outputPerMTok: 10, perSearch: 0.01 } },
  claude: { model: 'claude-opus-5-5', effort: 'low', price: { inputPerMTok: 4, outputPerMTok: 20, perSearch: 0.01 } }
} as const;

/** Where direct AI answers' web searches run from: the shop's home market. */
export const AI_SEARCH_LOCATION = { city: 'Orland Park', region: 'Illinois', country: 'US', timezone: 'America/Chicago' };

/** Domains that rank for everything and aren't contractors. Excluded when discovering competitors. */
export const NOT_COMPETITORS = [
  'yelp.com', 'angi.com', 'angieslist.com', 'homeadvisor.com', 'bbb.org', 'thumbtack.com', 'facebook.com', 'nextdoor.com',
  'houzz.com', 'porch.com', 'yellowpages.com', 'superpages.com', 'mapquest.com', 'reddit.com', 'youtube.com', 'google.com',
  'wikipedia.org', 'homedepot.com', 'lowes.com', 'carrier.com', 'trane.com', 'lennox.com', 'rheem.com', 'goodmanmfg.com',
  'forbes.com', 'bobvila.com', 'thisoldhouse.com', 'expertise.com', 'chamberofcommerce.com', 'manta.com',
  'threebestrated.com', 'networx.com', 'modernize.com', 'instagram.com', 'linkedin.com', 'indeed.com', 'bestpickreports.com'
];

/** Organic results checked per search. DataForSEO bills per 10 results, so 50 costs five times 10. */
export const RANK_DEPTH = 50;

/** How many discovered competitors to profile and to match in AI answers. */
export const COMPETITOR_LIMIT = 8;
