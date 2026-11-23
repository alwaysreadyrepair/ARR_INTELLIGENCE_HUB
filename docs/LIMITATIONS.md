# Known limitations (1.0)

- **No real property, market, weather, demand, coverage, import, quality or project data.** Those sections are refused in every build while their source is mock. Outbound is not included.
- SEO positions are samples; competitor traffic is a DataForSEO estimate; AI answers vary between runs.
- If the site is DNS-only in Cloudflare, crawler and edge totals show n/a. Privacy tools make AI-referral visits a floor.
- Sign-in is email and password only: no MFA, reset or sign-up in the Hub. Cloudflare Access is expected in front.
- A removed user keeps access until their access token expires. Cloudflare Access is the immediate cut-off.
- Roles don't differ yet, because nothing writes. Add MFA and audit events before any write action.
- The content security policy allows inline scripts and styles (Astro server islands, chart styles).
- Fonts load from Google.
- The PR 3 prices for direct AI answers are assumptions, so their recorded cost is approximate.
- `--max-usd` is checked against an estimate, not actual charges.
- Search Console, OpenAI, Anthropic, the remote KV scripts and the scheduled jobs have not been run live.
