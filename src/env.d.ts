/// <reference types="astro/client" />
type Env = {
  /** 'mock' (default) or 'supabase'. See src/repositories/index.ts. */
  DATA_SOURCE?: string;
  SUPABASE_URL?: string;
  /** Publishable key (`sb_publishable_…`): safe in the Worker, row-level security applies. */
  SUPABASE_PUBLISHABLE_KEY?: string;
  /** Used by @supabase/server to verify Supabase Auth JWTs. */
  SUPABASE_JWKS_URL?: string;
  /** 'mock' (default) or 'snapshot'. Where the SEO & AEO pages read from. See src/repositories/index.ts. */
  SEO_DATA_SOURCE?: string;
  /** KV namespace holding the SEO snapshot written by `npm run seo:load`. */
  SEO?: import('./repositories/seo.ts').SeoKv;
  /** 'mock' (default) or 'snapshot'. Where the Web Traffic pages read from. See src/repositories/index.ts. */
  TRAFFIC_DATA_SOURCE?: string;
  /** KV namespace holding the Cloudflare traffic snapshot written by `npm run traffic:load`. */
  TRAFFIC?: import('./repositories/traffic.ts').TrafficKv;
};
type Runtime<E> = import('@astrojs/cloudflare').Runtime<E>;
declare namespace App {
  interface Locals extends Runtime<Env> {
    user: import('./lib/session.ts').HubUser;
    repos: import('./repositories/types.ts').Repositories;
    /** One clock per request, so every freshness stamp on a page agrees. */
    now: Date;
    simulate: import('./lib/load.ts').Simulate;
  }
}
