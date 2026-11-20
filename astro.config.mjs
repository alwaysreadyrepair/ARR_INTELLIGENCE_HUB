import { defineConfig } from 'astro/config';
import cloudflare from '@astrojs/cloudflare';

// Internal app — no Webflow mount, no base path, no webflow.json (so Webflow Cloud never picks it up; the pricing
// app's apps/pricing/webflow.json is the only one in the repo). Server-rendered so filters are plain GET params
// and data access stays on the server, where the Supabase repositories will hold their keys.
export default defineConfig({
  output: 'server',
  // Adapter 13+ deploys a Worker (Pages support was removed) and runs `astro dev` inside workerd, so bindings and
  // vars from wrangler.json / .dev.vars are live in dev without the old platformProxy option.
  // The Hub has no images to transform and doesn't use Astro sessions, so neither an IMAGES binding nor a SESSION
  // KV namespace gets provisioned on deploy. Turn sessions back on (with a binding) when Supabase Auth needs them.
  adapter: cloudflare({ imageService: 'passthrough' }),
  session: false,
  // Astro 7 changed the default to 'jsx', which drops whitespace between inline elements and can glue words
  // together in the templates. Keep the Astro 5 behaviour.
  compressHTML: true,
  server: { port: 4322 },
  devToolbar: { enabled: false }
});
