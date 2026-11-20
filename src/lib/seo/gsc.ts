/* Google Search Console client for the refresh script: service-account sign-in and the Search Analytics query.
 *
 * Sign-in is the OAuth 2.0 service-account flow (a JWT signed with the account's private key, swapped for an access
 * token), done with node:crypto so the Hub needs no Google SDK. The service account only sees properties it has been
 * added to as a user in Search Console (Settings → Users and permissions → Add user, "Restricted" is enough).
 *
 * The API is free. Only the refresh script imports this file; pages read the snapshot. */

import { createSign } from 'node:crypto';
import type { GscMetrics, GscPageRow, GscQueryRow } from '../../domain/seo.ts';

export const TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/webmasters.readonly';
const API = 'https://www.googleapis.com/webmasters/v3';

export interface ServiceAccount {
  client_email: string;
  private_key: string;
}

/** Parses a service-account key file's JSON. Throws with a plain reason when it isn't one. */
export function parseServiceAccount(json: string): ServiceAccount {
  let raw: unknown;
  try {
    raw = JSON.parse(json);
  } catch {
    throw new Error('GSC_SERVICE_ACCOUNT is not valid JSON (expected a service-account key file, or a path to one).');
  }
  const o = raw as Partial<ServiceAccount> & { type?: string };
  if (typeof o.client_email !== 'string' || typeof o.private_key !== 'string') {
    throw new Error('GSC_SERVICE_ACCOUNT has no client_email/private_key. Use the JSON key of a service account (Google Cloud → IAM → Service accounts → Keys).');
  }
  return { client_email: o.client_email, private_key: o.private_key };
}

const b64url = (s: string | Buffer) => Buffer.from(s).toString('base64url');

/** The signed assertion swapped for an access token. Valid for an hour. */
export function signAssertion(sa: ServiceAccount, now = new Date()): string {
  const iat = Math.floor(now.getTime() / 1000);
  const header = b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claims = b64url(JSON.stringify({ iss: sa.client_email, scope: SCOPE, aud: TOKEN_URL, iat, exp: iat + 3600 }));
  const signer = createSign('RSA-SHA256');
  signer.update(`${header}.${claims}`);
  return `${header}.${claims}.${b64url(signer.sign(sa.private_key))}`;
}

type Fetch = typeof fetch;

export async function accessToken(sa: ServiceAccount, f: Fetch = fetch): Promise<string> {
  const res = await f(TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: signAssertion(sa) }),
    signal: AbortSignal.timeout(20_000)
  });
  const body = (await res.json().catch(() => ({}))) as { access_token?: string; error?: string; error_description?: string };
  if (!res.ok || !body.access_token) throw new Error(`Google sign-in failed (${res.status}): ${body.error_description ?? body.error ?? 'no access token'}.`);
  return body.access_token;
}

export type Dimension = 'date' | 'query' | 'page' | 'device' | 'country';

export interface QueryBody {
  startDate: string;
  endDate: string;
  dimensions?: Dimension[];
  rowLimit?: number;
  type?: 'web';
}

export interface GscRow extends GscMetrics {
  keys: string[];
}

/** POST searchAnalytics/query for one property. A 403 means the service account wasn't added to the property. */
export async function searchAnalytics(token: string, property: string, body: QueryBody, f: Fetch = fetch, clientEmail?: string): Promise<GscRow[]> {
  const res = await f(`${API}/sites/${encodeURIComponent(property)}/searchAnalytics/query`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'web', ...body }),
    signal: AbortSignal.timeout(60_000)
  });
  const json = (await res.json().catch(() => ({}))) as { rows?: unknown[]; error?: { message?: string } };
  if (res.status === 403) {
    throw new Error(`No access to ${property}.${clientEmail ? ` Add ${clientEmail} as a user on that property in Search Console (Settings → Users and permissions).` : ''} Google said: ${json.error?.message ?? 'forbidden'}`);
  }
  if (!res.ok) throw new Error(`Search Console ${res.status}: ${json.error?.message ?? 'request failed'}`);
  return parseRows(json);
}

const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** The API's rows, with missing numbers as 0. An empty period comes back with no `rows` key at all. */
export function parseRows(body: { rows?: unknown[] }): GscRow[] {
  return (body.rows ?? []).map((r) => {
    const o = r as { keys?: unknown[]; clicks?: unknown; impressions?: unknown; ctr?: unknown; position?: unknown };
    return { keys: (o.keys ?? []).map(String), clicks: n(o.clicks), impressions: n(o.impressions), ctr: n(o.ctr), position: n(o.position) };
  });
}

const DAY = 86_400_000;
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);

/** The current window (the last `days` days ending on `end`) and the one before it, as ISO dates. */
export function windows(end: string, days: number) {
  const e = Date.parse(`${end}T00:00:00Z`);
  return {
    period: { start: iso(e - (days - 1) * DAY), end, days },
    previous: { start: iso(e - (2 * days - 1) * DAY), end: iso(e - days * DAY) }
  };
}

/** The first day of the 16 months Google keeps, counted back from `today`. */
export const historyStart = (today: string) => iso(Date.parse(`${today}T00:00:00Z`) - 486 * DAY);

const metrics = (r: GscMetrics): GscMetrics => ({ clicks: r.clicks, impressions: r.impressions, ctr: r.ctr, position: r.position });

/** Joins one dimension's rows for the current window with the previous window's, by key. */
export function withPrevious<K extends 'query' | 'page'>(key: K, current: GscRow[], previous: GscRow[]): (K extends 'query' ? GscQueryRow : GscPageRow)[] {
  const before = new Map(previous.map((r) => [r.keys[0] ?? '', metrics(r)]));
  return current.map((r) => ({ [key]: r.keys[0] ?? '', ...metrics(r), prev: before.get(r.keys[0] ?? '') ?? null })) as (K extends 'query' ? GscQueryRow : GscPageRow)[];
}

/** Totals for a dateless query (one row, no keys), or zeros when the window had no data. */
export const totalsOf = (rows: GscRow[]): GscMetrics => (rows[0] ? metrics(rows[0]) : { clicks: 0, impressions: 0, ctr: 0, position: 0 });
