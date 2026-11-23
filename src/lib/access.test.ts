import test from 'node:test';
import assert from 'node:assert/strict';
import { generateKeyPair, exportJWK, SignJWT } from 'jose';
import { createServer } from 'node:http';
import type { AddressInfo } from 'node:net';
import { ambiguousPath, canShow, isPublic, landing, safeNext } from './access.ts';
import { createAuth, resolveSession, type Auth } from './auth.ts';
import { ROLES, userFromClaims } from './session.ts';

const mixed = { base: 'mock', seo: 'snapshot', traffic: 'snapshot' };

test('only the sign-in routes and health are public', () => {
  for (const p of ['/sign-in', '/sign-in/', '/auth/sign-in', '/auth/sign-out', '/api/health']) assert.equal(isPublic(p), true, p);
  for (const p of ['/', '/seo', '/properties', '/_server-islands/WeatherDemand', '/api/anything', '/sign-in/x', '/sign-inx', '/nope']) assert.equal(isPublic(p), false, p);
});

test('paths the router and the rules could read differently are refused', () => {
  for (const p of ['/properties/..%5Csign-in', '/properties/..%5Capi%5Chealth', '/_server-islands/..%5Csign-in', '/a\\b', '/a%255cb', '/a/%2e%2e/b', '/a%2fb', '/a%00', '/%', '/a%25252525255c']) assert.equal(ambiguousPath('https://hub.example' + p), true, p);
  for (const p of ['/', '/seo/', '/seo?next=..%5Cx', '/properties/p-2143', '/%73eo', '/_server-islands/WeatherDemand?e=a%2Fb']) assert.equal(ambiguousPath('https://hub.example' + p), false, p);
});

test('mock sections are hidden, and landing picks the first real one', () => {
  for (const p of ['/', '/properties', '/properties/1', '/markets', '/weather', '/imports/new', '/projects', '/_server-islands/WeatherDemand', '/seox']) assert.equal(canShow(p, mixed, true), false, p);
  for (const p of ['/seo', '/seo/', '/seo/ai', '/traffic/ai']) assert.equal(canShow(p, mixed, true), true, p);
  assert.equal(canShow('/markets', mixed, false), true);
  assert.equal(canShow('/seo', { ...mixed, seo: 'mock' }, true), false);
  assert.equal(landing(mixed, true), '/seo');
  assert.equal(landing({ ...mixed, seo: 'mock' }, true), '/traffic');
  assert.equal(landing({ base: 'mock', seo: 'mock', traffic: 'mock' }, true), null);
  assert.equal(landing(mixed, false), '/');
});

test('safeNext refuses anything off-site', () => {
  for (const bad of [null, '', 'https://evil.example', '//evil.example', '/\\evil.example', '/\t/evil.example', 'javascript:alert(1)', '/sign-in', '/a/..//evil.example']) assert.equal(safeNext(bad), '/', String(bad));
  assert.equal(safeNext('/seo/ai?range=90d'), '/seo/ai?range=90d');
});

test('roles come only from app_metadata', () => {
  for (const role of ROLES) assert.equal(userFromClaims({ sub: 'u', app_metadata: { hub_role: role } })?.role, role);
  for (const c of [{ sub: 'u' }, { sub: 'u', user_metadata: { hub_role: 'admin' } }, { sub: 'u', app_metadata: { hub_role: 'root' } }, { app_metadata: { hub_role: 'admin' } }, { sub: 'u', is_anonymous: true, app_metadata: { hub_role: 'admin' } }]) assert.equal(userFromClaims(c), null);
});

test('createAuth refuses missing or unsafe settings', () => {
  const ok = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' };
  assert.ok(createAuth(ok));
  for (const bad of [{}, { ...ok, SUPABASE_URL: 'http://x.example' }, { ...ok, SUPABASE_URL: 'nope' }, { ...ok, SUPABASE_PUBLISHABLE_KEY: 'sb_secret_x' }, { ...ok, SUPABASE_PUBLISHABLE_KEY: 'eyJservicerole' }, { ...ok, SUPABASE_JWKS_URL: 'https://evil.example/jwks' }]) assert.equal(createAuth(bad), null);
});

test('real signature checks: valid, expired, forged, wrong audience, wrong issuer, no role', async () => {
  const good = await generateKeyPair('ES256'), evil = await generateKeyPair('ES256');
  const jwk = { ...(await exportJWK(good.publicKey)), kid: 'k1', alg: 'ES256', use: 'sig' };
  const server = createServer((_q, r) => r.setHeader('content-type', 'application/json').end(JSON.stringify({ keys: [jwk] })));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  try {
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const auth = createAuth({ SUPABASE_URL: base, SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' })!;
    const sign = (o: { key?: CryptoKey; exp?: number; aud?: string; iss?: string; meta?: object } = {}) =>
      new SignJWT({ email: 'a@example.com', app_metadata: o.meta ?? { hub_role: 'viewer' } }).setProtectedHeader({ alg: 'ES256', kid: 'k1' })
        .setSubject('u1').setAudience(o.aud ?? 'authenticated').setIssuer(o.iss ?? `${base}/auth/v1`).setExpirationTime(Math.floor(Date.now() / 1000) + (o.exp ?? 600)).sign(o.key ?? good.privateKey);
    const status = async (t: string) => (await auth.verify(t)).status;
    assert.equal(await status(await sign()), 'ok');
    assert.equal(await status(await sign({ exp: -600 })), 'invalid');
    assert.equal(await status(await sign({ key: evil.privateKey })), 'invalid');
    assert.equal(await status(await sign({ aud: 'anon' })), 'invalid');
    assert.equal(await status(await sign({ iss: 'https://evil.example/auth/v1' })), 'invalid');
    assert.equal(await status(await sign({ meta: {} })), 'forbidden');
    assert.equal(await status('garbage'), 'invalid');
  } finally {
    server.close();
  }
});

test('session resolution: refresh once, fail closed, outage is not a sign-out', async () => {
  const user = { id: 'u', name: 'u', role: 'viewer' as const, stub: false };
  const tokens = { access: 'new', refresh: 'r2', expiresIn: 60 };
  let refreshes = 0;
  const auth: Auth = {
    verify: async (t) => (t === 'new' || t === 'good' ? { status: 'ok', user } : t === 'down' ? { status: 'unavailable' } : { status: 'invalid' }),
    refresh: async (t) => { refreshes++; return t === 'r1' ? { status: 'ok', tokens } : t === 'down' ? { status: 'unavailable' } : { status: 'invalid' }; },
    signIn: async () => ({ status: 'invalid' }), signOut: async () => undefined
  };
  assert.equal((await resolveSession(auth, undefined, undefined)).status, 'invalid');
  assert.equal((await resolveSession(auth, 'good', 'r1')).status, 'ok');
  assert.equal((await resolveSession(auth, 'down', 'r1')).status, 'unavailable');
  assert.equal(refreshes, 0);
  assert.deepEqual((await resolveSession(auth, 'old', 'r1')).tokens, tokens);
  assert.equal((await resolveSession(auth, undefined, 'used')).status, 'invalid');
  assert.equal((await resolveSession(auth, undefined, 'down')).status, 'unavailable');
});

test('password grant: bad password, rate limit, outage and success stay distinct', async () => {
  const env = { SUPABASE_URL: 'https://x.supabase.co', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' };
  const at = async (status: number, body: object = {}) => (await createAuth(env, async () => Response.json(body, { status }))!.signIn('a', 'b')).status;
  assert.equal(await at(400), 'invalid');
  assert.equal(await at(429), 'unavailable');
  assert.equal(await at(500), 'unavailable');
  assert.equal(await at(200), 'invalid');
  assert.equal(await at(200, { access_token: 'a', refresh_token: 'r', expires_in: 60 }), 'ok');
  assert.equal((await createAuth(env, async () => { throw new Error('net'); })!.signIn('a', 'b')).status, 'unavailable');
});
