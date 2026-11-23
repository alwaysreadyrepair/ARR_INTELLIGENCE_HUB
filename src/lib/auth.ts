/* Supabase Auth over plain fetch, with the access token verified against the project's signing keys on every request.
 * The browser only ever holds httpOnly cookies. Needs SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY; no secret key. */
import { verifyCredentials } from '@supabase/server/core';
import { isLocalHost } from './access.ts';
import { userFromClaims, type HubUser } from './session.ts';

export interface AuthEnv { SUPABASE_URL?: string; SUPABASE_PUBLISHABLE_KEY?: string; SUPABASE_JWKS_URL?: string }
export interface Tokens { access: string; refresh: string; expiresIn: number }
/** `unavailable` = Supabase could not be reached or is misconfigured. It never counts as signed in or out. */
export type Check = { status: 'ok'; user: HubUser } | { status: 'forbidden' } | { status: 'invalid' } | { status: 'unavailable' };
export type Grant = { status: 'ok'; tokens: Tokens } | { status: 'invalid' } | { status: 'unavailable' };

export interface Auth {
  verify(access: string): Promise<Check>;
  signIn(email: string, password: string): Promise<Grant>;
  refresh(refresh: string): Promise<Grant>;
  signOut(access: string): Promise<void>;
}

/** Null when the settings are missing or unsafe; callers then refuse every request. */
export function createAuth(env: AuthEnv, fetcher: typeof fetch = (...a) => fetch(...a), verifier: typeof verifyCredentials = verifyCredentials): Auth | null {
  const key = env.SUPABASE_PUBLISHABLE_KEY?.trim();
  if (!env.SUPABASE_URL || !key?.startsWith('sb_publishable_')) return null;
  let base: URL, jwks: URL;
  try {
    base = new URL(env.SUPABASE_URL);
    jwks = new URL(env.SUPABASE_JWKS_URL || '/auth/v1/.well-known/jwks.json', base);
  } catch {
    return null;
  }
  // Signing keys must come from the same project that issues the tokens.
  if (jwks.origin !== base.origin || (base.protocol !== 'https:' && !isLocalHost(base.hostname))) return null;
  const url = (p: string) => `${base.origin}/auth/v1/${p}`;

  async function grant(type: 'password' | 'refresh_token', body: object): Promise<Grant> {
    try {
      const res = await fetcher(url(`token?grant_type=${type}`), {
        method: 'POST', headers: { apikey: key!, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(10_000)
      });
      if (res.status === 429 || res.status >= 500 || res.status === 401) return { status: 'unavailable' };
      if (!res.ok) return { status: 'invalid' };
      const j = (await res.json()) as { access_token?: string; refresh_token?: string; expires_in?: number };
      if (!j.access_token || !j.refresh_token) return { status: 'invalid' };
      return { status: 'ok', tokens: { access: j.access_token, refresh: j.refresh_token, expiresIn: j.expires_in ?? 3600 } };
    } catch {
      return { status: 'unavailable' };
    }
  }

  return {
    async verify(access) {
      try {
        const { data, error } = await verifier({ token: access, apikey: null }, {
          auth: 'user', audience: 'authenticated', issuer: url('').replace(/\/$/, ''),
          env: { url: base.origin, publishableKeys: { default: key }, secretKeys: {}, jwks }
        });
        if (error) return { status: error.status >= 500 ? 'unavailable' : 'invalid' };
        const user = userFromClaims(data.jwtClaims as unknown as Record<string, unknown>);
        return user ? { status: 'ok', user } : { status: 'forbidden' };
      } catch {
        return { status: 'unavailable' };
      }
    },
    signIn: (email, password) => grant('password', { email, password }),
    refresh: (refresh_token) => grant('refresh_token', { refresh_token }),
    async signOut(access) {
      await fetcher(url('logout?scope=local'), { method: 'POST', headers: { apikey: key, Authorization: `Bearer ${access}` }, signal: AbortSignal.timeout(5_000) }).catch(() => undefined);
    }
  };
}

/** The session behind a request's cookies: verify, and refresh once when the access token is missing or rejected. */
export async function resolveSession(auth: Auth, access: string | undefined, refresh: string | undefined): Promise<Check & { tokens?: Tokens }> {
  if (access) {
    const c = await auth.verify(access);
    if (c.status !== 'invalid') return c;
  }
  if (!refresh) return { status: 'invalid' };
  const g = await auth.refresh(refresh);
  if (g.status !== 'ok') return g;
  return { ...(await auth.verify(g.tokens.access)), tokens: g.tokens };
}
