import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Internal app — no Webflow mount, no base path, no webflow.json (so Webflow Cloud never picks it up; the pricing
// app's apps/pricing/webflow.json is the only one in the repo). Server-rendered so filters are plain GET params
// and data access stays on the server, where the Supabase repositories will hold their keys.
export default defineConfig({
  output: 'server',
  adapter: cloudflare({ platformProxy: { enabled: true } }),
  server: { port: 4322 },
  devToolbar: { enabled: false }
});
