/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />
/* `Env` itself is generated from wrangler.json by `npm run types` (worker-configuration.d.ts, git-ignored): the SEO
 * KV binding plus the DATA_SOURCE and SEO_DATA_SOURCE vars. This adds the settings wrangler.json doesn't declare. */
interface Env {
  SUPABASE_URL?: string;
  SUPABASE_ANON_KEY?: string;
}
declare namespace App {
  interface Locals extends import('@astrojs/cloudflare').Runtime {
    user: import('./lib/session.ts').HubUser;
    repos: import('./repositories/types.ts').Repositories;
    /** One clock per request, so every freshness stamp on a page agrees. */
    now: Date;
    simulate: import('./lib/load.ts').Simulate;
  }
}
