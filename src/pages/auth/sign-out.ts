import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createAuth, resolveSession } from '../../lib/auth.ts';
import { clearTokens, readTokens } from '../../lib/cookies.ts';

export const POST: APIRoute = async ({ cookies, url, redirect }) => {
  const t = readTokens(cookies, url);
  const auth = createAuth(env);
  if (auth && (t.access || t.refresh)) {
    // An expired access token can't revoke anything, so refresh first: the refresh token must not outlive a sign-out.
    const s = await resolveSession(auth, t.access, t.refresh);
    const access = s.tokens?.access ?? t.access;
    if (access) await auth.signOut(access);
  }
  clearTokens(cookies, url);
  return redirect('/sign-in', 303);
};
