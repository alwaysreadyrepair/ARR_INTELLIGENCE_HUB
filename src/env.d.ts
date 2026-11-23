/// <reference types="astro/client" />
/// <reference path="../worker-configuration.d.ts" />
/* `Env` itself is generated from wrangler.json by `npm run types` (worker-configuration.d.ts, git-ignored): the SEO
 * and TRAFFIC KV bindings plus the DATA_SOURCE, SEO_DATA_SOURCE and TRAFFIC_DATA_SOURCE vars. This adds the settings wrangler.json doesn't declare. */
declare namespace Cloudflare {
  interface Env {
    /** `supabase` turns real sign-in on in `astro dev`; builds always use it. */
    AUTH_MODE?: string;
    /** `true` hides mock sections in `astro dev`, as every build does. */
    HIDE_MOCK?: string;
    SUPABASE_URL?: string;
    /** Publishable key (`sb_publishable_…`): safe in the Worker, row-level security applies. */
    SUPABASE_PUBLISHABLE_KEY?: string;
    /** Used by @supabase/server to verify Supabase Auth JWTs. */
    SUPABASE_JWKS_URL?: string;
  }
}
declare namespace App {
  interface Locals extends import('@astrojs/cloudflare').Runtime {
    user: import('./lib/session.ts').HubUser;
    repos: import('./repositories/types.ts').Repositories;
    /** One clock per request, so every freshness stamp on a page agrees. */
    now: Date;
    /** This request's session check, so a middleware rerun doesn't refresh twice. */
    session?: import('./lib/auth.ts').Check & { tokens?: import('./lib/auth.ts').Tokens };
    /** Mock sections are refused and left out of the nav. */
    hideMock: boolean;
    simulate: import('./lib/load.ts').Simulate;
  }
}
