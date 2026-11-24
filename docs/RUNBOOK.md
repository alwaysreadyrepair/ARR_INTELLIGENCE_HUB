# Runbook

Nothing here has run against a live Supabase or Cloudflare environment yet. Check each step the first time.

## First deploy
1. **Repository:** make it private first.
2. **Supabase** (one project per environment): turn off public sign-up, use asymmetric JWT signing keys (legacy HS256 tokens are refused), and keep the access-token lifetime short. A removed user keeps access until their current token expires.
3. **KV:** create four namespaces (SEO and TRAFFIC, staging and production) and put their ids in `wrangler.json`.
4. **wrangler.json:** the Workers are `arr-hub-live` (production) and `arr-intelligence-hub-staging`. Never reuse `arr-intelligence-hub`: that is the earlier Hub, still live. Replace every `REPLACE_ME`. The publishable key is safe there; a `sb_secret_` key never is.
5. **Zone settings:** turn on Always Use HTTPS, and add a rate-limit rule on `/auth/sign-in` (unlimited attempts there use up the shared Supabase limit). Keep Supabase's default refresh-token reuse interval.
6. **Cloudflare Access:** put the hostname behind it before the first deploy.
7. `npm run deploy -- staging --dry-run`, then `npm run deploy -- staging`. It refuses to run with gaps and runs tests, types and build first.
8. **Signed out, confirm:** `/`, `/seo` and `/properties` redirect or refuse, and `/api/health` answers `{"ok":true}`.
9. Repeat for production.

## Users
Add a user in Supabase (Authentication, Users), then run this in its SQL editor. Roles: `viewer`, `analyst`, `operator`, `admin`. All four currently see the same read-only pages.

```sql
update auth.users
set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || '{"hub_role":"viewer"}'::jsonb
where email = 'person@example.com';
```

- **Change a role:** run it again; it applies at the next token refresh or sign-in.
- **Remove:** delete the user, which ends their refresh; also remove them from Cloudflare Access for an immediate cut-off.
- **Reset a password:** an admin sets it in Supabase. The Hub has no self-service reset.

## Refreshing data
By hand: `npm run snapshot -- pull seo production`, `npm run seo:refresh -- --max-usd=5`, `npm run snapshot -- push seo production`. Same for `traffic` with `traffic:refresh`. Push refuses if live changed since your pull, and first copies live to a dated backup key. For the very first run add `--first-run` to both snapshot commands; it stops if the key already exists or can't be listed.

On a schedule, create a GitHub `production` environment with:

| Kind | Name |
|---|---|
| Secret | `DATAFORSEO_LOGIN`, `DATAFORSEO_PASSWORD`, `CLOUDFLARE_ANALYTICS_TOKEN` (read-only), `CLOUDFLARE_KV_TOKEN` (KV edit), `CLOUDFLARE_ACCOUNT_ID` |
| Optional secret | `GSC_SERVICE_ACCOUNT`, `OPENAI_API_KEY`, `ANTHROPIC_API_KEY` |
| Variable | `SEO_MAX_USD` (unset means 0, so a paid run refuses to start) |
| Repository variable | `REFRESH_ENABLED` = `true` turns both schedules on |

`--max-usd` checks the estimate before starting. It is not a hard cap: also set spending limits at each provider. Direct OpenAI and Anthropic calls are billed separately.

## When something breaks
| Symptom | Do |
|---|---|
| "Sign-in is not configured" | `SUPABASE_URL` or the publishable key is missing or malformed |
| "Sign-in is temporarily unavailable" | Supabase status; signing keys endpoint. Also shown when Supabase rate-limits |
| Everyone returns to sign-in | Project uses HS256 tokens, or `SUPABASE_URL` is another project's |
| "Your account has no Hub access" | Set `hub_role` (above) |
| Panel says no snapshot | Run the refresh, then push |
| Refresh job failed | Read the log. A failed step keeps its previous data. Don't blindly rerun a paid step |
| Pull failed | Fix access. Don't use `--first-run`: it discards history |
| Bad deploy | `npx wrangler rollback --env production`, then fix on a branch |
| Bad snapshot | Copy a good `.seo/history/<date>.json` to `.seo/snapshot.json`, then push with `--rollback` |
| Key leaked | Revoke at the provider, replace the secret, rerun |

Monitor `/api/health` from any uptime service. GitHub emails on a failed scheduled job.
