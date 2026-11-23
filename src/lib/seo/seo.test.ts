import { test } from 'node:test';
import assert from 'node:assert/strict';
import { brandNames, citationsFrom, excerpt, markdownToText, matchAnswer, mentionSpans, ownedDomain } from './match.ts';
import {
  credentialsFromEnv, createClient, DataForSeoError, llmTask, parseBacklinks, parseDomainRank, parseLlm, parseMaps, parseModels, parseOrganic,
  parseSearchVolume, pickModel, unwrap
} from './dataforseo.ts';
import { auditPage, parseRobots, parseSitemap, schemaTypes, wordCount } from './audit.ts';
import { auditIssues, localSummary, mentionTrend, rankBuckets, rankChanges, rankTrend, shareOfVoice, topCitedDomains } from './stats.ts';
import type { AiAnswer, RankObservation, SeoBrand, SiteAudit } from '../../domain/seo.ts';

const ARR: SeoBrand = { domain: 'alwaysreadyrepair.com', name: 'ARR Heating + Cooling', names: ['ARR Heating + Cooling', 'Always Ready Repair'], own: true };
const ACME: SeoBrand = { domain: 'acmeheating.example', name: 'Acme Heating', names: ['Acme Heating'], own: false };
const BOLT: SeoBrand = { domain: 'boltair.example', name: 'Bolt Air', names: ['Bolt Air'], own: false };

// ─── match.ts ───

test('markdownToText strips citation pills but keeps real link text', () => {
  const md = '## Top picks\n- **Always Ready Repair** offers upfront pricing [1](https://a.com/x) [a.com](https://a.com/)\n- See [their pricing page](https://alwaysreadyrepair.com/pricing)';
  const text = markdownToText(md);
  assert.ok(!text.includes('[1]') && !text.includes('a.com]'));
  assert.ok(text.includes('their pricing page'));
  assert.ok(!text.includes('**') && !text.includes('##'));
});

test('mentionSpans matches whole words, ignores URLs and emails, keeps original offsets', () => {
  const text = 'Try Always  Ready Repair or visit https://alwaysreadyrepair.com, email hi@alwaysreadyrepair.com. AlwaysReadyRepairs is not us.';
  const spans = mentionSpans(text, ['Always Ready Repair', 'alwaysreadyrepair']);
  assert.equal(spans.length, 1);
  assert.equal(text.slice(spans[0]!.start, spans[0]!.end), 'Always  Ready Repair');
});

test('mentionSpans handles accents and keeps the longest overlapping match', () => {
  assert.equal(mentionSpans('Café Comfort and Cafe Comfort', ['Cafe Comfort']).length, 1, 'NFD form only matches the unaccented spelling');
  const spans = mentionSpans('ARR Heating + Cooling is local', ['ARR Heating + Cooling', 'ARR Heating']);
  assert.equal(spans.length, 1);
  assert.equal(spans[0]!.end - spans[0]!.start, 'ARR Heating + Cooling'.length);
});

test('brandNames adds a long domain stem but not a short one', () => {
  assert.ok(brandNames(ARR).includes('alwaysreadyrepair'));
  assert.ok(!brandNames({ domain: 'abc.com', name: 'ABC', names: [] }).includes('abc'));
});

test('citationsFrom drops unsafe URLs, tracking params and duplicates', () => {
  const c = citationsFrom([
    { url: 'https://www.Example.com/a?utm_source=x&id=2#top', title: 'A' },
    { url: 'https://www.example.com/a?id=2' },
    { url: 'javascript:alert(1)' },
    { url: 'not a url' },
    { nope: true }
  ]);
  assert.deepEqual(c, [{ url: 'https://www.example.com/a?id=2', domain: 'example.com', title: 'A' }]);
});

test('ownedDomain accepts subdomains only', () => {
  assert.ok(ownedDomain('www.alwaysreadyrepair.com', 'alwaysreadyrepair.com'));
  assert.ok(ownedDomain('blog.alwaysreadyrepair.com', 'alwaysreadyrepair.com'));
  assert.ok(!ownedDomain('alwaysreadyrepair.com.evil.example', 'alwaysreadyrepair.com'));
  assert.ok(!ownedDomain('notalwaysreadyrepair.com', 'alwaysreadyrepair.com'));
});

test('matchAnswer reports mention, citation, order among brands and competitors', () => {
  const m = matchAnswer(
    { text: 'Top options: Acme Heating, then Always Ready Repair. Bolt Air is also nearby.', citations: [{ url: 'https://alwaysreadyrepair.com/x', domain: 'alwaysreadyrepair.com', title: null }, { url: 'https://yelp.com/b', domain: 'yelp.com', title: null }] },
    ARR, [ACME, BOLT]
  );
  assert.equal(m.answered, true);
  assert.equal(m.mentioned, true);
  assert.equal(m.cited, true);
  assert.equal(m.mentionRank, 2);
  assert.deepEqual(m.competitorsMentioned, ['acmeheating.example', 'boltair.example']);
  assert.deepEqual(m.citedDomains, ['alwaysreadyrepair.com', 'yelp.com']);

  const none = matchAnswer({ text: '', citations: [] }, ARR, [ACME]);
  assert.equal(none.answered, false);
  assert.equal(none.mentionRank, null);
});

test('excerpt centres on the mention and stays short', () => {
  const long = `${'word '.repeat(200)}Always Ready Repair is great ${'more '.repeat(200)}`;
  const e = excerpt(long, long.indexOf('Always'));
  assert.ok(e.length <= 402);
  assert.ok(e.includes('Always Ready Repair'));
  assert.ok(e.startsWith('…') && e.endsWith('…'));
});

// ─── dataforseo.ts ───

test('credentialsFromEnv reads login/password or the base64 API key', () => {
  assert.deepEqual(credentialsFromEnv({ DATAFORSEO_LOGIN: 'a@b.c', DATAFORSEO_PASSWORD: 'p:w' }), { login: 'a@b.c', password: 'p:w' });
  assert.deepEqual(credentialsFromEnv({ DATAFORSEO_API_KEY: Buffer.from('me@x.y:sec:ret').toString('base64') }), { login: 'me@x.y', password: 'sec:ret' });
  assert.equal(credentialsFromEnv({}), null);
});

test('unwrap returns results and cost, treats 40102 as empty, throws on errors', () => {
  assert.deepEqual(unwrap({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.002, result: [{ a: 1 }] }] }, '/p'), { result: [{ a: 1 }], cost: 0.002 });
  assert.deepEqual(unwrap({ status_code: 20000, tasks: [{ status_code: 40102, cost: 0.002, result: null }] }, '/p'), { result: [], cost: 0.002 });
  assert.throws(() => unwrap({ status_code: 40100, status_message: 'Unauthorized' }, '/p'), /40100: Unauthorized/);
  assert.throws(() => unwrap({ status_code: 20000, tasks: [{ status_code: 40501, status_message: 'Invalid Field', cost: 0.01 }] }, '/p'), (e: unknown) => e instanceof DataForSeoError && e.cost === 0.01);
});

test('client posts one task with basic auth and never retries a billed call', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  let status = 500;
  const fake = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response(status === 200 ? JSON.stringify({ status_code: 20000, tasks: [{ status_code: 20000, cost: 0.1, result: [] }] }) : 'boom', { status });
  }) as unknown as typeof fetch;
  const client = createClient({ login: 'u', password: 'p' }, { fetch: fake, base: 'https://x' });
  await assert.rejects(client.post('/v3/a', { keyword: 'k' }), /HTTP 500/);
  assert.equal(calls.length, 1, 'billed call not retried');
  assert.equal(new Headers(calls[0]!.init.headers).get('Authorization'), `Basic ${Buffer.from('u:p').toString('base64')}`);
  assert.deepEqual(JSON.parse(String(calls[0]!.init.body)), [{ keyword: 'k' }]);
  calls.length = 0;
  await assert.rejects(client.get('/v3/models'));
  assert.equal(calls.length, 3, 'free GET retried twice');
  status = 200;
  assert.equal((await client.get('/v3/models')).cost, 0.1);
});

test('parseOrganic finds our position, who is above, features, pack and AI Overview', () => {
  const result = [{
    item_types: ['local_pack', 'organic', 'ai_overview', 'people_also_ask'],
    items: [
      { type: 'ai_overview', markdown: 'Consider **Always Ready Repair** or Acme Heating [1](https://acmeheating.example/)', references: [{ url: 'https://www.alwaysreadyrepair.com/furnace', title: 'Furnace' }] },
      { type: 'local_pack', title: 'Acme Heating & Air', domain: 'acmeheating.example', rank_group: 1 },
      { type: 'local_pack', title: 'ARR Heating + Cooling', domain: 'www.alwaysreadyrepair.com', rank_group: 2 },
      { type: 'organic', rank_group: 1, rank_absolute: 4, domain: 'www.yelp.com', url: 'https://www.yelp.com/x' },
      { type: 'organic', rank_group: 2, rank_absolute: 5, domain: 'acmeheating.example', url: 'https://acmeheating.example/' },
      { type: 'organic', rank_group: 3, rank_absolute: 6, domain: 'www.alwaysreadyrepair.com', url: 'https://www.alwaysreadyrepair.com/furnace' },
      { type: 'organic', rank_group: 11, rank_absolute: 15, domain: 'far.example', url: 'https://far.example/' }
    ]
  }];
  const p = parseOrganic(result, 'alwaysreadyrepair.com');
  assert.equal(p.row.position, 3);
  assert.equal(p.row.url, 'https://www.alwaysreadyrepair.com/furnace');
  assert.deepEqual(p.row.topCompetitor, { domain: 'yelp.com', position: 1 });
  assert.deepEqual(p.row.features, ['local_pack', 'ai_overview', 'people_also_ask']);
  assert.equal(p.row.inLocalPack, true);
  assert.deepEqual(p.top10, ['yelp.com', 'acmeheating.example', 'alwaysreadyrepair.com']);
  assert.deepEqual(p.packNames[0], { title: 'Acme Heating & Air', domain: 'acmeheating.example' });
  assert.ok(p.aiOverview!.text.includes('Always Ready Repair'));
  assert.equal(p.aiOverview!.citations[0]!.domain, 'alwaysreadyrepair.com');

  const absent = parseOrganic([{ items: [{ type: 'organic', rank_group: 1, domain: 'a.example' }] }], 'alwaysreadyrepair.com');
  assert.equal(absent.row.position, null);
  assert.equal(absent.aiOverview, null);
  assert.deepEqual(parseOrganic([], 'alwaysreadyrepair.com').row.position, null);
});

test('parseMaps reads our position and the top three with ratings', () => {
  const m = parseMaps([{ items: [
    { type: 'maps_search', rank_group: 1, title: 'Acme', domain: 'acmeheating.example', rating: { value: 4.8, votes_count: 210 } },
    { type: 'maps_search', rank_group: 2, title: 'ARR Heating + Cooling', domain: 'alwaysreadyrepair.com', rating: { value: 4.9, votes_count: 600 } },
    { type: 'maps_search', rank_group: 3, title: 'No Site Co', domain: null, rating: null },
    { type: 'maps_search', rank_group: 4, title: 'Fourth', domain: 'four.example' }
  ] }], 'alwaysreadyrepair.com');
  assert.equal(m.position, 2);
  assert.equal(m.topThree.length, 3);
  assert.deepEqual(m.topThree[2], { title: 'No Site Co', domain: null, rating: null, reviews: null });
  assert.equal(m.names.length, 4);
});

test('parseLlm joins message sections and collects annotations', () => {
  const a = parseLlm([{ items: [
    { type: 'reasoning', sections: [{ text: 'thinking' }] },
    { type: 'message', sections: [{ text: 'Call **Always Ready Repair**.', annotations: [{ url: 'https://alwaysreadyrepair.com/', title: 'ARR' }] }, { text: 'Or Acme.' }] }
  ] }]);
  assert.equal(a.text, 'Call Always Ready Repair.\n\nOr Acme.');
  assert.equal(a.citations.length, 1);
});

test('pickModel takes the newest matching alias', () => {
  assert.equal(pickModel('chatgpt', ['gpt-5', 'gpt-5.2', 'gpt-5.10', 'gpt-5.5-2026-04-23', 'gpt-5.6-luna', 'gpt-4o']), 'gpt-5.10');
  assert.equal(pickModel('claude', ['claude-sonnet-4-5', 'claude-sonnet-5', 'claude-opus-5']), 'claude-sonnet-5');
  assert.equal(pickModel('gemini', ['gemini-2.5-pro']), null);
  assert.deepEqual(parseModels([{ model_name: 'a' }, { x: 1 }, null]), ['a']);
});

test('llmTask sets engine-specific search fields', () => {
  assert.equal(llmTask('claude', 'm', 'q').force_web_search, true);
  assert.equal('web_search_country_iso_code' in llmTask('gemini', 'm', 'q'), false);
  assert.equal(llmTask('chatgpt', 'm', 'q').web_search_country_iso_code, 'US');
});

test('parseSearchVolume, parseDomainRank and parseBacklinks map the fields', () => {
  const kw = parseSearchVolume([{ keyword: 'furnace repair', search_volume: 1900, cpc: 21.5, competition: 'HIGH', monthly_searches: [{ year: 2026, month: 1, search_volume: 2400 }, { year: 2025, month: 12, search_volume: 2900 }] }]);
  assert.deepEqual(kw[0], { keyword: 'furnace repair', searchVolume: 1900, cpc: 21.5, competition: 'HIGH', monthly: [{ month: '2025-12', volume: 2900 }, { month: '2026-01', volume: 2400 }] });
  assert.deepEqual(parseDomainRank([{ items: [{ metrics: { organic: { pos_1: 10, pos_2_3: 15, count: 400, etv: 1830.6 } } }] }]), { organicKeywords: 400, estTraffic: 1831, top3Keywords: 25 });
  assert.deepEqual(parseDomainRank([]), { organicKeywords: null, estTraffic: null, top3Keywords: null });
  assert.deepEqual(parseBacklinks([{ referring_domains: 138, backlinks: 2210 }]), { referringDomains: 138, backlinks: 2210 });
});

// ─── audit.ts ───

const PAGE = (body: string, head = '') => `<html><head><title>Furnace Repair in Orland Park, IL | ARR</title><meta name="description" content="Upfront furnace repair pricing."><meta property="og:title" content="x"><link rel="canonical" href="https://alwaysreadyrepair.com/furnace">${head}</head><body><nav>Menu Home About</nav><h1>Furnace repair</h1>${body}<footer>Footer words here</footer></body></html>`;
const words = (n: number) => `<p>${'word '.repeat(n)}</p>`;

test('auditPage passes a clean page and counts body words only', () => {
  const p = auditPage('https://alwaysreadyrepair.com/furnace', 200, PAGE(words(400)));
  assert.equal(p.wordCount, 402);
  assert.deepEqual(p.issues, []);
  assert.equal(p.h1Count, 1);
});

test('auditPage flags the problems that matter for search and AI', () => {
  const html = `<html><head><meta name="robots" content="noindex"><script type="application/ld+json">{bad json</script></head><body><h1>A</h1><h1>B</h1><div class="faq-card">Q?</div><img src="a.jpg"><img src="px.gif" width="1" height="1"><noscript><img src="n.gif"></noscript>${words(50)}</body></html>`;
  const codes = auditPage('https://alwaysreadyrepair.com/', 200, html, { home: true }).issues.map((i) => i.code).sort();
  assert.deepEqual(codes, ['canonical-missing', 'faq-without-schema', 'h1-multiple', 'images-missing-alt', 'meta-description-missing', 'no-business-schema', 'noindex', 'og-missing', 'schema-invalid', 'thin-content', 'title-missing']);
});

test('auditPage reads JSON-LD types through @graph and accepts FAQPage', () => {
  const ld = '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"HVACBusiness","name":"ARR"},{"@type":"FAQPage","mainEntity":[{"@type":"Question"}]}]}</script>';
  const p = auditPage('https://alwaysreadyrepair.com/', 200, PAGE(`<details><summary>Q?</summary>A</details>${words(400)}`, ld), { home: true });
  assert.deepEqual(p.schemaTypes, ['FAQPage', 'HVACBusiness', 'Question']);
  assert.deepEqual(p.issues, []);
  assert.deepEqual(schemaTypes('<script type="application/ld+json">[{"@type":["A","B"]}]</script>'), { types: ['A', 'B'], invalid: 0 });
});

test('auditPage reports redirects and errors without parsing', () => {
  assert.equal(auditPage('u', 404, '').issues[0]!.code, 'http-error');
  assert.equal(auditPage('u', 301, '').issues[0]!.code, 'redirect');
  assert.equal(wordCount('<body><script>var a = 1</script>Hello &amp; welcome</body>'), 2, 'scripts and lone symbols are not words');
});

test('parseRobots finds AI bots blocked site-wide and sitemaps', () => {
  const r = parseRobots('User-agent: *\nDisallow: /admin\n\nUser-agent: GPTBot\nUser-agent: CCBot\nDisallow: /\n\nUser-agent: ClaudeBot\nDisallow: /\nAllow: /\n\nSitemap: https://alwaysreadyrepair.com/sitemap.xml # main');
  assert.deepEqual(r.blockedAiBots, ['GPTBot', 'CCBot']);
  assert.deepEqual(r.sitemaps, ['https://alwaysreadyrepair.com/sitemap.xml']);
  assert.ok(parseRobots('User-agent: *\nDisallow: /').blockedAiBots.includes('PerplexityBot'), 'the * group applies to bots without their own');
  assert.deepEqual(parseRobots('User-agent: *\nDisallow:').blockedAiBots, []);
});

test('parseSitemap reads urls and detects an index', () => {
  assert.deepEqual(parseSitemap('<urlset><url><loc> https://a.com/x?a=1&amp;b=2 </loc></url></urlset>'), { urls: ['https://a.com/x?a=1&b=2'], isIndex: false });
  assert.equal(parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s.xml</loc></sitemap></sitemapindex>').isIndex, true);
});

// ─── stats.ts ───

const rank = (date: string, keyword: string, marketId: string, position: number | null): RankObservation => ({ date, keyword, marketId, position, url: null, topCompetitor: null, features: [], inLocalPack: false });

test('rank roll-ups: buckets, trend and changes since the previous refresh', () => {
  const rows = [rank('2026-11-09', 'a', 'm', 5), rank('2026-11-09', 'b', 'm', null), rank('2026-11-16', 'a', 'm', 2), rank('2026-11-16', 'b', 'm', 30), rank('2026-11-16', 'c', 'm', 9)];
  assert.deepEqual(rankBuckets(rows.filter((r) => r.date === '2026-11-16')).map((b) => b.count), [1, 1, 0, 1, 0]);
  assert.deepEqual(rankTrend(rows), [{ date: '2026-11-09', top3: 0, top10: 1, checks: 2 }, { date: '2026-11-16', top3: 1, top10: 2, checks: 3 }]);
  const ch = rankChanges(rows);
  assert.deepEqual(ch.map((c) => [c.keyword, c.prev, c.delta]), [['a', 5, 3], ['b', null, null], ['c', null, null]]);
});

const ans = (date: string, engine: AiAnswer['engine'], o: Partial<AiAnswer>): AiAnswer => ({ date, promptId: 'p', engine, answered: true, mentioned: false, cited: false, mentionRank: null, competitorsMentioned: [], citedDomains: [], excerpt: '', ...o });

test('AI roll-ups: mention trend leaves unanswered out, share of voice, cited domains', () => {
  const rows = [
    ans('d1', 'chatgpt', { mentioned: true, cited: true, citedDomains: ['alwaysreadyrepair.com', 'yelp.com'] }),
    ans('d1', 'chatgpt', { competitorsMentioned: ['acmeheating.example'], citedDomains: ['yelp.com', 'yelp.com'] }),
    ans('d1', 'google_ai_overview', { answered: false })
  ];
  const t = mentionTrend(rows, ['chatgpt', 'google_ai_overview']);
  assert.deepEqual(t[0]!.byEngine.chatgpt, { mentioned: 1, cited: 1, answered: 2, asked: 2 });
  assert.deepEqual(t[0]!.byEngine.google_ai_overview, { mentioned: 0, cited: 0, answered: 0, asked: 1 });
  assert.deepEqual(shareOfVoice(rows, ARR, [BOLT, ACME]).map((s) => [s.domain, s.answers]), [['alwaysreadyrepair.com', 1], ['acmeheating.example', 1], ['boltair.example', 0]]);
  assert.deepEqual(topCitedDomains(rows), [{ domain: 'yelp.com', count: 2 }, { domain: 'alwaysreadyrepair.com', count: 1 }]);
});

test('localSummary and auditIssues group and order', () => {
  assert.deepEqual(localSummary([{ date: 'd', keyword: 'k', marketId: 'm', position: 2, topThree: [] }, { date: 'd', keyword: 'k', marketId: 'n', position: null, topThree: [] }]), { checks: 2, top3: 1, listed: 1 });
  const audit: SiteAudit = {
    crawledAt: '2026-11-16T00:00:00Z', pagesCrawled: 2, pagesInSitemap: 2, robots: { present: true, blockedAiBots: [], sitemapListed: true }, llmsTxt: false,
    siteIssues: [{ code: 'llms-txt-missing', severity: 'low', message: 'x', aeo: true }],
    pages: [
      { url: 'a', status: 200, title: null, metaDescription: null, h1Count: 1, wordCount: 100, canonical: null, noindex: false, schemaTypes: [], issues: [{ code: 'thin-content', severity: 'medium', message: 'Only 100 words', aeo: true }] },
      { url: 'b', status: 200, title: null, metaDescription: null, h1Count: 1, wordCount: 90, canonical: null, noindex: false, schemaTypes: [], issues: [{ code: 'thin-content', severity: 'medium', message: 'Only 90 words', aeo: true }, { code: 'noindex', severity: 'high', message: 'n', aeo: false }] }
    ]
  };
  const g = auditIssues(audit);
  assert.deepEqual(g.map((i) => [i.code, i.pages]), [['noindex', 1], ['thin-content', 2], ['llms-txt-missing', 0]]);
  assert.ok(!g[1]!.message.includes('100'), 'grouped message is generic');
});

// ─── gsc.ts and the Search Console roll-ups ───

test('signAssertion makes an RS256 JWT for the Search Console scope that verifies with the account key', async () => {
  const { generateKeyPairSync, createVerify } = await import('node:crypto');
  const { signAssertion, parseServiceAccount, SCOPE, TOKEN_URL } = await import('./gsc.ts');
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = parseServiceAccount(JSON.stringify({ type: 'service_account', client_email: 'hub@arr.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }) }));
  const jwt = signAssertion(sa, new Date('2026-11-20T12:00:00Z'));
  const [h, c, sig] = jwt.split('.');
  assert.deepEqual(JSON.parse(Buffer.from(h!, 'base64url').toString()), { alg: 'RS256', typ: 'JWT' });
  const claims = JSON.parse(Buffer.from(c!, 'base64url').toString());
  assert.equal(claims.iss, sa.client_email);
  assert.equal(claims.scope, SCOPE);
  assert.equal(claims.aud, TOKEN_URL);
  assert.equal(claims.exp - claims.iat, 3600);
  const v = createVerify('RSA-SHA256');
  v.update(`${h}.${c}`);
  assert.ok(v.verify(publicKey, Buffer.from(sig!, 'base64url')));
});

test('parseServiceAccount rejects JSON that is not a service-account key', async () => {
  const { parseServiceAccount } = await import('./gsc.ts');
  assert.throws(() => parseServiceAccount('not json'), /not valid JSON/);
  assert.throws(() => parseServiceAccount('{"installed":{}}'), /client_email/);
});

test('searchAnalytics posts to the property and explains a 403', async () => {
  const { searchAnalytics } = await import('./gsc.ts');
  let seen = '';
  const ok = (async (u: string, init: RequestInit) => {
    seen = `${u} ${String(init.body)}`;
    return new Response(JSON.stringify({ rows: [{ keys: ['furnace repair'], clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 }, { keys: ['x'] }] }), { status: 200 });
  }) as unknown as typeof fetch;
  const rows = await searchAnalytics('tok', 'sc-domain:alwaysreadyrepair.com', { startDate: '2026-10-01', endDate: '2026-10-28', dimensions: ['query'] }, ok);
  assert.ok(seen.includes('/sites/sc-domain%3Aalwaysreadyrepair.com/searchAnalytics/query'));
  assert.ok(seen.includes('"type":"web"'));
  assert.deepEqual(rows[0], { keys: ['furnace repair'], clicks: 3, impressions: 40, ctr: 0.075, position: 6.2 });
  assert.deepEqual(rows[1], { keys: ['x'], clicks: 0, impressions: 0, ctr: 0, position: 0 });
  const denied = (async () => new Response(JSON.stringify({ error: { message: 'User does not have sufficient permission' } }), { status: 403 })) as unknown as typeof fetch;
  await assert.rejects(searchAnalytics('tok', 'sc-domain:x.com', { startDate: 'a', endDate: 'b' }, denied, 'hub@x.iam'), /Add hub@x\.iam as a user/);
});

test('windows gives two back-to-back windows of equal length; withPrevious joins by key', async () => {
  const { windows, withPrevious, totalsOf } = await import('./gsc.ts');
  assert.deepEqual(windows('2026-11-17', 28), { period: { start: '2026-10-21', end: '2026-11-17', days: 28 }, previous: { start: '2026-09-23', end: '2026-10-20' } });
  const m = (clicks: number) => ({ clicks, impressions: clicks * 10, ctr: 0.1, position: 5 });
  const joined = withPrevious('query', [{ keys: ['a'], ...m(5) }, { keys: ['b'], ...m(2) }], [{ keys: ['a'], ...m(3) }]);
  assert.equal(joined[0]!.query, 'a');
  assert.equal(joined[0]!.prev?.clicks, 3);
  assert.equal(joined[1]!.prev, null);
  assert.deepEqual(totalsOf([]), { clicks: 0, impressions: 0, ctr: 0, position: 0 });
});

test('isBrandQuery spots ARR by name, domain or "arr" + an HVAC word, and nothing else', async () => {
  const { isBrandQuery } = await import('./stats.ts');
  for (const q of ['arr heating and cooling', 'ARR Heating & Cooling reviews', 'always ready repair orland park', 'alwaysreadyrepair.com', 'arr hvac']) assert.ok(isBrandQuery(q, ARR), q);
  for (const q of ['furnace repair orland park', 'carrier furnace', 'arrow heating', 'hvac near me']) assert.ok(!isBrandQuery(q, ARR), q);
});

test('sumMetrics weights position by impressions; gscWeekly drops partial weeks', async () => {
  const { sumMetrics, gscWeekly } = await import('./stats.ts');
  const s = sumMetrics([{ clicks: 10, impressions: 100, ctr: 0.1, position: 2 }, { clicks: 0, impressions: 300, ctr: 0, position: 10 }]);
  assert.equal(s.clicks, 10);
  assert.equal(s.ctr, 10 / 400);
  assert.equal(s.position, 8);
  // 2026-11-02 is a Monday: Sun 1st (partial week), then a full Mon–Sun week, then Mon 9th alone.
  const days = Array.from({ length: 9 }, (_, i) => ({ date: `2026-11-0${i + 1}`, clicks: 1, impressions: 10, ctr: 0.1, position: 5 }));
  assert.deepEqual(gscWeekly(days), [{ week: '2026-11-02', clicks: 7, impressions: 70 }]);
});

test('trackedKeywordTraffic matches every word in any order, skipping brand; gscOpportunities keeps positions 4–20', async () => {
  const { trackedKeywordTraffic, gscOpportunities } = await import('./stats.ts');
  const row = (query: string, impressions: number, position: number, clicks = 1) => ({ query, clicks, impressions, ctr: clicks / impressions, position, prev: null });
  const queries = [row('furnace repair orland park', 100, 6), row('orland park furnace repair near me', 50, 12), row('arr heating furnace repair', 30, 1), row('furnace replacement', 80, 9)];
  const [repair] = trackedKeywordTraffic(queries, [{ keyword: 'furnace repair', service: 'furnace' }], ARR);
  assert.equal(repair!.terms, 2);
  assert.equal(repair!.impressions, 150);
  assert.equal(repair!.position, 8);
  const wins = gscOpportunities([...queries, row('ac repair', 500, 2), row('boiler repair', 10, 8), row('hvac company', 300, 25)], ARR);
  assert.deepEqual(wins.map((w) => w.query), ['furnace repair orland park', 'furnace replacement', 'orland park furnace repair near me']);
});

// ─── grid.ts and the grid roll-ups ───

test('gridPoints covers every market plus the margin, north-west first, each point naming its nearest city', async () => {
  const { gridPoints, milesBetween } = await import('./grid.ts');
  const markets = [
    { id: 'a', city: 'A', locationName: '', lat: 41.6, lon: -87.9 },
    { id: 'b', city: 'B', locationName: '', lat: 41.5, lon: -87.8 }
  ];
  const pts = gridPoints(markets, 2, 1);
  const rows = Math.max(...pts.map((p) => p.row)) + 1, cols = Math.max(...pts.map((p) => p.col)) + 1;
  assert.equal(pts.length, rows * cols);
  assert.ok(pts[0]!.lat > pts.at(-1)!.lat && pts[0]!.lon < pts.at(-1)!.lon, 'row 0 north, col 0 west');
  // Neighbours are spacing apart.
  assert.ok(Math.abs(milesBetween(pts[0]!, pts[1]!) - 2) < 0.01);
  assert.ok(Math.abs(milesBetween(pts[0]!, pts[cols]!) - 2) < 0.01);
  // Every market sits within half a cell diagonal of some point.
  for (const m of markets) assert.ok(Math.min(...pts.map((p) => milesBetween(p, m))) <= Math.SQRT2 + 0.01);
  for (const p of pts) {
    const nearest = markets.reduce((b, m) => (milesBetween(p, m) < milesBetween(p, b) ? m : b));
    assert.equal(p.marketId, nearest.id);
  }
  assert.deepEqual(gridPoints([], 2, 1), []);
});

test('grid roll-ups: summary counts unlisted as 21, leaders flag ours, trend and cities use the right refresh', async () => {
  const { gridSummary, gridLeaders, gridTrend, gridByCity } = await import('./stats.ts');
  const pt = (row: number, marketId: string, date: string, position: number | null, leader: string) =>
    ({ row, col: 0, lat: 41.6, lon: -87.8, marketId, date, keyword: 'hvac company', position, leader: { title: leader, domain: leader === 'ARR' ? 'alwaysreadyrepair.com' : `${leader.toLowerCase()}.example` } });
  const rows = [
    pt(0, 'a', '2026-11-09', 5, 'Acme'),
    pt(0, 'a', '2026-11-16', 1, 'ARR'), pt(1, 'a', '2026-11-16', 3, 'Acme'), pt(2, 'b', '2026-11-16', null, 'Acme'), pt(3, 'b', '2026-11-16', 9, 'Bolt')
  ];
  assert.deepEqual(gridSummary(rows), { points: 4, top3: 2, listed: 3, avgPosition: (1 + 3 + 21 + 9) / 4 });
  assert.deepEqual(gridLeaders(rows, 'alwaysreadyrepair.com').map((l) => [l.name, l.points, l.own]), [['Acme', 2, false], ['ARR', 1, true], ['Bolt', 1, false]]);
  assert.deepEqual(gridTrend(rows), [{ date: '2026-11-09', top3: 0, points: 1 }, { date: '2026-11-16', top3: 2, points: 4 }]);
  assert.deepEqual(gridByCity(rows), [{ marketId: 'a', top3: 2, points: 2 }, { marketId: 'b', top3: 0, points: 2 }]);
});

// ─── openai.ts ───

test('openAiRequest asks with web search placed in our area and no system prompt', async () => {
  const { openAiRequest } = await import('./openai.ts');
  const body = openAiRequest('gpt-5.5', 'Who is the best HVAC company in Orland Park, IL?', { city: 'Orland Park', region: 'Illinois', country: 'US', timezone: 'America/Chicago' }, 'low');
  assert.equal(body.input, 'Who is the best HVAC company in Orland Park, IL?');
  assert.deepEqual(body.tools, [{ type: 'web_search', user_location: { type: 'approximate', city: 'Orland Park', region: 'Illinois', country: 'US', timezone: 'America/Chicago' } }]);
  assert.equal(body.reasoning.effort, 'low');
  assert.ok(!('instructions' in body));
});

test('parseOpenAiResponse reads the message text, url citations, tokens and searches', async () => {
  const { parseOpenAiResponse, costOf } = await import('./openai.ts');
  const p = parseOpenAiResponse({
    status: 'completed',
    output: [
      { type: 'reasoning', summary: [] },
      { type: 'web_search_call', status: 'completed' },
      { type: 'web_search_call', status: 'completed' },
      { type: 'message', content: [{ type: 'output_text', text: '**ARR Heating + Cooling** shows prices online ([alwaysreadyrepair.com](https://alwaysreadyrepair.com/pricing)).', annotations: [
        { type: 'url_citation', url: 'https://alwaysreadyrepair.com/pricing?utm_source=openai', title: 'Pricing' },
        { type: 'url_citation', url: 'https://www.yelp.com/biz/x', title: 'Yelp' }
      ] }] }
    ],
    usage: { input_tokens: 10_000, output_tokens: 1_000 }
  });
  assert.ok(p.answer.text.startsWith('ARR Heating + Cooling shows prices online'));
  assert.deepEqual(p.answer.citations.map((c) => c.domain), ['alwaysreadyrepair.com', 'yelp.com']);
  assert.deepEqual([p.inputTokens, p.outputTokens, p.searches, p.complete], [10_000, 1_000, 2, true]);
  assert.equal(costOf({ inputPerMTok: 1.25, outputPerMTok: 10, perSearch: 0.01 }, 10_000, 1_000, 2), 0.0425);
  assert.equal(parseOpenAiResponse({ status: 'incomplete', output: [] }).complete, false);
});

test('askOpenAi records the served model and cost, and surfaces OpenAI errors without retrying', async () => {
  const { askOpenAi } = await import('./openai.ts');
  const where = { city: 'Orland Park', region: 'Illinois', country: 'US', timezone: 'America/Chicago' };
  const price = { inputPerMTok: 1, outputPerMTok: 1, perSearch: 0 };
  let calls = 0;
  const ok = (async () => (calls++, new Response(JSON.stringify({ status: 'completed', model: 'gpt-5.5-2026-10-01', output: [], usage: { input_tokens: 500_000, output_tokens: 500_000 } }), { status: 200 }))) as unknown as typeof fetch;
  const a = await askOpenAi('k', 'gpt-5.5', 'q', where, 'low', price, ok);
  assert.equal(a.model, 'gpt-5.5-2026-10-01');
  assert.equal(a.usd, 1);
  const bad = (async () => (calls++, new Response(JSON.stringify({ error: { message: 'Incorrect API key provided' } }), { status: 401 }))) as unknown as typeof fetch;
  await assert.rejects(askOpenAi('k', 'gpt-5.5', 'q', where, 'low', price, bad), /OpenAI 401: Incorrect API key/);
  assert.equal(calls, 2);
});

// ─── claude.ts ───

test('parseClaudeContent joins the text blocks and keeps only web-search citations', async () => {
  const { parseClaudeContent } = await import('./claude.ts');
  const content = [
    { type: 'server_tool_use', id: 's1', name: 'web_search', input: { query: 'hvac orland park' } },
    { type: 'web_search_tool_result', tool_use_id: 's1', content: [{ type: 'web_search_result', url: 'https://www.angi.com/x', title: 'Angi' }] },
    { type: 'text', text: 'Homeowners often recommend ', citations: null },
    { type: 'text', text: '**ARR Heating + Cooling**, which lists prices online.', citations: [
      { type: 'web_search_result_location', url: 'https://alwaysreadyrepair.com/pricing', title: 'Pricing', cited_text: '…', encrypted_index: 'x' }
    ] }
  ] as unknown as Parameters<typeof parseClaudeContent>[0];
  const a = parseClaudeContent(content);
  assert.equal(a.text, 'Homeowners often recommend ARR Heating + Cooling, which lists prices online.');
  assert.deepEqual(a.citations.map((c) => c.domain), ['alwaysreadyrepair.com']);
});

test('hasAnthropicCredentials needs a key, a token or a named profile', async () => {
  const { hasAnthropicCredentials } = await import('./claude.ts');
  assert.equal(hasAnthropicCredentials({}), false);
  assert.equal(hasAnthropicCredentials({ ANTHROPIC_API_KEY: '  ' }), false);
  assert.equal(hasAnthropicCredentials({ ANTHROPIC_API_KEY: 'sk-ant-x' }), true);
  assert.equal(hasAnthropicCredentials({ ANTHROPIC_PROFILE: 'arr' }), true);
});

test('askClaude resumes a paused turn, sums usage and searches, and returns empty on refusal', async () => {
  const { askClaude } = await import('./claude.ts');
  const where = { city: 'Orland Park', region: 'Illinois', country: 'US', timezone: 'America/Chicago' };
  const price = { inputPerMTok: 4, outputPerMTok: 20, perSearch: 0.01 };
  const usage = (i: number, o: number, s: number) => ({ input_tokens: i, output_tokens: o, cache_creation_input_tokens: null, cache_read_input_tokens: null, server_tool_use: { web_search_requests: s, web_fetch_requests: 0 } });
  const sent: { messages: unknown[]; tools: { user_location: unknown }[]; fallbacks: unknown }[] = [];
  const replies = [
    { model: 'claude-opus-5-5', stop_reason: 'pause_turn', content: [{ type: 'text', text: 'Looking. ', citations: null }], usage: usage(5_000, 100, 2) },
    { model: 'claude-opus-5-5', stop_reason: 'end_turn', content: [{ type: 'text', text: 'Try ARR Heating + Cooling.', citations: null }], usage: usage(5_000, 400, 1) }
  ];
  const fake = { beta: { messages: { create: async (req: (typeof sent)[number]) => (sent.push(structuredClone(req)), replies.shift()) } } } as unknown as Parameters<typeof askClaude>[0];
  const a = await askClaude(fake, 'claude-opus-5-5', 'Who is the best HVAC company in Orland Park, IL?', where, 'low', price);
  assert.equal(sent.length, 2);
  assert.equal(sent[1]!.messages.length, 2, 'paused assistant turn sent back, no extra user message');
  assert.equal(sent[0]!.fallbacks, 'default');
  assert.deepEqual(sent[0]!.tools[0]!.user_location, { type: 'approximate', ...where });
  assert.equal(a.text, 'Looking. Try ARR Heating + Cooling.');
  assert.deepEqual([a.searches, a.complete, a.usd], [3, true, (10_000 * 4 + 500 * 20) / 1e6 + 0.03]);

  const refusing = { beta: { messages: { create: async () => ({ model: 'claude-opus-5-5', stop_reason: 'refusal', content: [{ type: 'text', text: 'partial', citations: null }], usage: usage(100, 10, 0) }) } } } as unknown as Parameters<typeof askClaude>[0];
  const r = await askClaude(refusing, 'claude-opus-5-5', 'q', where, 'low', price);
  assert.deepEqual([r.text, r.complete], ['', false]);
});
