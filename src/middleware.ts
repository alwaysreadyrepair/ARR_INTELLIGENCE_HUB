import { defineMiddleware } from 'astro:middleware';
import { env } from 'cloudflare:workers';
import { getRepositories } from './repositories/index.ts';
import { DEV_USER } from './lib/session.ts';
import { createAuth, resolveSession, type Check, type Tokens } from './lib/auth.ts';
import { clearTokens, readTokens, writeTokens } from './lib/cookies.ts';
import { ambiguousPath, canShow, isLocalHost, isPublic, kindOf, landing, SECURITY_HEADERS } from './lib/access.ts';
import type { Simulate } from './lib/load.ts';

const SIMULATE = new Set(['error', 'empty', 'slow']);
const text = (status: number, body: string) => new Response(body, { status, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });

/* Every request: verify the session (fail closed), refuse pages whose data is still mock in a built Worker, attach the
 * repositories and the request clock. The stub user needs a dev build *and* a localhost
 * request, so a wrongly built Worker on a real hostname still demands sign-in. AUTH_MODE=supabase and HIDE_MOCK=true switch the deployed behaviour on in `astro dev`. */
export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, url, cookies, request } = context;
  const finish = (res: Response) => {
    const out = new Response(res.body, res);
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      if (import.meta.env.DEV && isLocalHost(url.hostname) && (k === 'Content-Security-Policy' || k === 'Strict-Transport-Security')) continue; // Vite's dev client needs websockets and eval
      out.headers.set(k, v);
    }
    return out;
  };
  if (ambiguousPath(request.url)) return finish(text(400, 'Bad request.'));
  const local = isLocalHost(url.hostname);
  if (url.protocol !== 'https:' && !local) {
    if (request.method !== 'GET' && request.method !== 'HEAD') return finish(text(403, 'HTTPS only.'));
    return finish(context.redirect(`https://${url.host}${url.pathname}${url.search}`, 308));
  }
  const path = url.pathname;
  // The matched route and the URL must both be public, so a path they read differently is private.
  const open = isPublic(path) && isPublic(context.routePattern);
  if (open && path === '/api/health') return finish(await next());

  const dev = import.meta.env.DEV && local;
  const stub = dev && env.AUTH_MODE !== 'supabase';
  if (stub) locals.user = DEV_USER;
  else if (!open) {
    const auth = createAuth(env);
    if (!auth) return finish(text(503, 'Sign-in is not configured.'));
    const t = readTokens(cookies, url);
    // A 404 can run this twice for one request; reuse the first answer so the refresh token is spent once.
    const s: Check & { tokens?: Tokens } = (locals.session ??= await resolveSession(auth, t.access, t.refresh));
    if (s.tokens) writeTokens(cookies, url, s.tokens);
    if (s.status === 'unavailable') return finish(text(503, 'Sign-in is temporarily unavailable. Try again in a minute.'));
    if (s.status === 'forbidden') return finish(context.redirect('/sign-in?error=role', 303));
    if (s.status === 'invalid') {
      if (t.access || t.refresh) clearTokens(cookies, url);
      const page = request.method === 'GET' && (request.headers.get('accept') ?? '').includes('text/html') && !path.startsWith('/_') && !path.startsWith('/api/');
      return finish(page ? context.redirect(`/sign-in?next=${encodeURIComponent(path + url.search)}`, 303) : text(401, 'Sign in required.'));
    }
    locals.user = s.user;
  }

  // Bindings and vars come from `cloudflare:workers` (Astro 6+ removed `locals.runtime.env`; reading it now throws).
  locals.repos = getRepositories(env);
  locals.now = new Date();
  const kinds = { base: locals.repos.kind, seo: locals.repos.seo.kind, traffic: locals.repos.traffic.kind };
  locals.hideMock = !dev || env.HIDE_MOCK === 'true';
  if (!open && !canShow(path, kinds, locals.hideMock)) {
    const to = landing(kinds, locals.hideMock);
    if (path === '/' && to) return finish(context.redirect(to, 303));
    return finish(text(404, to ? 'Not available: this section has no real data yet.' : 'The Hub has no real data loaded yet. See docs/RUNBOOK.md.'));
  }
  // State simulation is a mock-mode review aid. It never applies to real data.
  const sim = url.searchParams.get('simulate');
  locals.simulate = kindOf(path, kinds) === 'mock' && sim && SIMULATE.has(sim) ? (sim as Simulate) : null;
  return finish(await next());
});
