import type { APIRoute } from 'astro';
import { env } from 'cloudflare:workers';
import { createAuth } from '../../lib/auth.ts';
import { safeNext } from '../../lib/access.ts';
import { writeTokens } from '../../lib/cookies.ts';

/* Cross-site posts are refused by Astro's checkOrigin before this runs. */
export const POST: APIRoute = async ({ request, cookies, url, redirect }) => {
  const form = await request.formData().catch(() => null);
  const field = (k: string) => { const v = form?.get(k); return typeof v === 'string' ? v : ''; };
  const next = safeNext(field('next'));
  const back = (error: string) => redirect(`/sign-in?error=${error}&next=${encodeURIComponent(next)}`, 303);
  const email = field('email').trim(), password = field('password');
  if (!email || !password || email.length > 320 || password.length > 1024) return back('invalid');
  const auth = createAuth(env);
  if (!auth) return back('unavailable');
  const g = await auth.signIn(email, password);
  if (g.status !== 'ok') return back(g.status);
  const c = await auth.verify(g.tokens.access);
  if (c.status === 'forbidden') return back('role');
  if (c.status !== 'ok') return back('unavailable');
  writeTokens(cookies, url, g.tokens);
  return redirect(next, 303);
};
