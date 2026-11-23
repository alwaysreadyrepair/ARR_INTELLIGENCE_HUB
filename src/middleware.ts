import { defineMiddleware } from 'astro:middleware';
import { getRepositories } from './repositories/index.ts';
import { DEV_USER } from './lib/session.ts';
import type { Simulate } from './lib/load.ts';

const SIMULATE = new Set(['error', 'empty', 'slow']);

/* Attaches the stub user, the repositories and the request clock to every request. When Supabase Auth lands,
 * this is where the session cookie gets verified and unauthenticated requests get redirected to sign-in. */
export const onRequest = defineMiddleware(async (context, next) => {
  const { locals, url } = context;
  locals.user = DEV_USER;
  locals.repos = getRepositories(locals.runtime?.env);
  locals.now = new Date();
  // State simulation is a mock-mode review aid. It never applies to real data.
  const sim = url.searchParams.get('simulate');
  const under = (p: string) => url.pathname === p || url.pathname.startsWith(`${p}/`);
  const kind = under('/seo') ? locals.repos.seo.kind : under('/traffic') ? locals.repos.traffic.kind : locals.repos.kind;
  locals.simulate = kind === 'mock' && sim && SIMULATE.has(sim) ? (sim as Simulate) : null;
  return next();
});
