/* Which paths anyone may open, which ones depend on data that is still mock, and where a visitor lands. Pure, so every
 * rule is tested without a server. Anything not listed as public needs a session. */
const PUBLIC = new Set(['/sign-in', '/auth/sign-in', '/auth/sign-out', '/api/health']);

/** Same normalization everywhere: one trailing slash never changes the answer. */
export const cleanPath = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') || '/' : p);
export const isLocalHost = (h: string) => ['localhost', '127.0.0.1', '[::1]'].includes(h);

/** True when a raw request path could mean different things to the router and to these rules: a backslash, a control
 *  character or a dot segment at any decoding depth, or encoding that doesn't settle. Refuse it before anything else. */
export function ambiguousPath(rawUrl: string): boolean {
  let p = rawUrl.replace(/^[a-z]+:\/\/[^/]*/i, '').split(/[?#]/)[0] ?? '';
  for (let i = 0; i < 4; i++) {
    if (/[\\\x00-\x1f\x7f]/.test(p) || /(^|\/)\.\.?(\/|$)/.test(p) || /%2f/i.test(p)) return true;
    let d: string;
    try { d = decodeURIComponent(p); } catch { return true; }
    if (d === p) return false;
    p = d;
  }
  return true;
}
export const isPublic = (path: string) => PUBLIC.has(cleanPath(path));

export interface Kinds { base: string; seo: string; traffic: string }
const under = (path: string, root: string) => path === root || path.startsWith(`${root}/`);

/** Data kind a path shows. Everything outside SEO and Web Traffic, server islands included, is the base source. */
export function kindOf(path: string, k: Kinds): string {
  const p = cleanPath(path);
  return under(p, '/seo') ? k.seo : under(p, '/traffic') ? k.traffic : k.base;
}

/** False when the path would show mock numbers in a build that must not. */
export const canShow = (path: string, k: Kinds, hideMock: boolean) => !hideMock || kindOf(path, k) !== 'mock';

/** First section with real data, for `/` when the overview is hidden. */
export function landing(k: Kinds, hideMock: boolean): string | null {
  return ['/', '/seo', '/traffic'].find((p) => canShow(p, k, hideMock)) ?? null;
}

/** A safe same-site path to return to after sign-in. Refuses other origins, protocol-relative and backslash forms. */
export function safeNext(raw: string | null | undefined): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || /[\\\x00-\x1f]/.test(raw)) return '/';
  const u = new URL(raw, 'https://hub.invalid');
  if (u.origin !== 'https://hub.invalid' || u.pathname.startsWith('//') || isPublic(u.pathname)) return '/';
  return u.pathname + u.search;
}

/** Headers for every response. Inline scripts and styles stay allowed: charts use style attributes and Astro inlines
 *  the server-island loader. Signed-in pages are never stored by a browser or a proxy. */
export const SECURITY_HEADERS: Record<string, string> = {
  'Cache-Control': 'private, no-store',
  'Content-Security-Policy': "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; object-src 'none'; form-action 'self'",
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Referrer-Policy': 'same-origin',
  'Strict-Transport-Security': 'max-age=31536000',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'X-Robots-Tag': 'noindex, nofollow'
};
