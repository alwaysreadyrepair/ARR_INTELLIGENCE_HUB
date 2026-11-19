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
