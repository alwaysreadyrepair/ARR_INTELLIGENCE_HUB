import type { AstroCookies } from 'astro';
import { isLocalHost } from './access.ts';
import type { Tokens } from './auth.ts';

/* `__Host-` pins a cookie to this exact host over HTTPS. Only plain-HTTP localhost gets the unprefixed names. */
const secure = (url: URL) => url.protocol === 'https:' || !isLocalHost(url.hostname);
const names = (url: URL) => (secure(url) ? { a: '__Host-hub-at', r: '__Host-hub-rt' } : { a: 'hub-at', r: 'hub-rt' });

export function readTokens(cookies: AstroCookies, url: URL) {
  const n = names(url);
  return { access: cookies.get(n.a)?.value, refresh: cookies.get(n.r)?.value };
}
export function writeTokens(cookies: AstroCookies, url: URL, t: Tokens) {
  const n = names(url), o = { httpOnly: true, secure: secure(url), sameSite: 'lax' as const, path: '/' };
  cookies.set(n.a, t.access, { ...o, maxAge: t.expiresIn });
  cookies.set(n.r, t.refresh, { ...o, maxAge: 7 * 86_400 });
}
export function clearTokens(cookies: AstroCookies, url: URL) {
  const n = names(url), o = { path: '/', secure: secure(url) };
  cookies.delete(n.a, o);
  cookies.delete(n.r, o);
}
