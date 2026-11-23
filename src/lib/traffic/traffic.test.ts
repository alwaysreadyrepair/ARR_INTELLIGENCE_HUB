import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crawlerQuery, parseCrawlers, parseRum, parseZoneDays, createCfClient } from './cloudflare.ts';
import { aiReferrals, assistantFor, bucketDays, classifyBot, crawlerTotals, eachDay, edgeCoverage, edgeGap, mergeHistory, reviewEdge, shiftDay } from './stats.ts';

test('classifyBot picks the specific OpenAI and Anthropic agents, not the broad ones', () => {
  assert.equal(classifyBot('Mozilla/5.0 AppleWebKit/537.36; compatible; ChatGPT-User/1.0; +https://openai.com/bot')?.id, 'chatgpt-user');
  assert.equal(classifyBot('Mozilla/5.0; compatible; GPTBot/1.2; +https://openai.com/gptbot')?.id, 'gptbot');
  assert.equal(classifyBot('Mozilla/5.0 (compatible; ClaudeBot/1.0; +claudebot@anthropic.com)')?.id, 'claudebot');
  assert.equal(classifyBot('Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)')?.purpose, 'search-engine');
  assert.equal(classifyBot('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Safari/605.1.15'), null);
});

test('assistantFor matches assistant hosts and subdomains only', () => {
  assert.equal(assistantFor('chatgpt.com')?.id, 'chatgpt');
  assert.equal(assistantFor('www.perplexity.ai')?.id, 'perplexity');
  assert.equal(assistantFor('gemini.google.com')?.id, 'gemini');
  assert.equal(assistantFor('www.google.com'), null);
  assert.equal(assistantFor('notchatgpt.com'), null);
  const ai = aiReferrals([{ host: 'chatgpt.com', visits: 5 }, { host: 'chat.openai.com', visits: 2 }, { host: 'www.google.com', visits: 90 }, { host: 'claude.ai', visits: 1 }]);
  assert.deepEqual(ai.map((a) => [a.assistant.id, a.visits]), [['chatgpt', 7], ['claude', 1]]);
});

test('mergeHistory replaces refreshed days whole and trims old ones', () => {
  const prev = [{ date: '2026-11-01', bot: 'a', requests: 1 }, { date: '2026-11-02', bot: 'a', requests: 2 }, { date: '2026-11-02', bot: 'b', requests: 9 }];
  const next = [{ date: '2026-11-02', bot: 'a', requests: 3 }, { date: '2026-11-03', bot: 'a', requests: 4 }];
  const out = mergeHistory(prev, next, (r) => `${r.date}|${r.bot}`, '2026-11-02');
  assert.deepEqual(out, [{ date: '2026-11-02', bot: 'a', requests: 3 }, { date: '2026-11-03', bot: 'a', requests: 4 }]);
});

test('day helpers', () => {
  assert.equal(shiftDay('2026-03-01', 1), '2026-02-28');
  assert.equal(shiftDay('2026-12-31', -1), '2027-01-01');
  assert.equal(eachDay('2026-11-01', '2026-11-10').length, 10);
  const b = bucketDays(eachDay('2026-11-01', '2026-11-10'), 7);
  assert.deepEqual(b.map((x) => [x.from, x.to]), [['2026-11-01', '2026-11-03'], ['2026-11-04', '2026-11-10']]);
});

test('parseZoneDays splits 4xx and 5xx out of the status map', () => {
  const rows = parseZoneDays({ viewer: { zones: [{ httpRequests1dGroups: [{
    dimensions: { date: '2026-11-19' },
    sum: { requests: 100, cachedRequests: 60, bytes: 1000, cachedBytes: 700, pageViews: 30, threats: 1,
      responseStatusMap: [{ edgeResponseStatus: 200, requests: 90 }, { edgeResponseStatus: 404, requests: 6 }, { edgeResponseStatus: 403, requests: 2 }, { edgeResponseStatus: 503, requests: 2 }] },
    uniq: { uniques: 12 }
  }] }] } });
  assert.deepEqual(rows[0], { date: '2026-11-19', requests: 100, cachedRequests: 60, bytes: 1000, cachedBytes: 700, pageViews: 30, uniques: 12, threats: 1, status4xx: 8, status5xx: 2 });
});

test('parseRum drops our own host from referrers', () => {
  const out = parseRum({ viewer: { accounts: [{
    days: [{ count: 40, sum: { visits: 18 }, dimensions: { date: '2026-11-19' } }],
    pages: [{ count: 20, sum: { visits: 9 }, dimensions: { requestPath: '' } }],
    referrers: [{ sum: { visits: 30 }, dimensions: { refererHost: 'www.alwaysreadyrepair.com' } }, { sum: { visits: 8 }, dimensions: { refererHost: 'ChatGPT.com' } }]
  }] } }, 'alwaysreadyrepair.com');
  assert.deepEqual(out.days, [{ date: '2026-11-19', visits: 18, pageViews: 40 }]);
  assert.equal(out.pages[0]!.path, '/');
  assert.deepEqual(out.referrers, [{ host: 'chatgpt.com', visits: 8 }]);
});

test('parseCrawlers folds User-Agent variants into one bot per day and skips unknown agents', () => {
  const out = parseCrawlers({ viewer: { zones: [{
    byDay: [
      { count: 5, dimensions: { date: '2026-11-19', userAgent: 'GPTBot/1.1' } },
      { count: 3, dimensions: { date: '2026-11-19', userAgent: 'Mozilla/5.0; compatible; GPTBot/1.2' } },
      { count: 9, dimensions: { date: '2026-11-19', userAgent: 'curl/8.0' } }
    ],
    byPath: [{ count: 4, dimensions: { userAgent: 'GPTBot/1.2', clientRequestPath: '/' } }],
    notFound: [{ count: 7, dimensions: { clientRequestPath: '/wp-login.php' } }]
  }] } });
  assert.deepEqual(out.days, [{ date: '2026-11-19', bot: 'gptbot', requests: 8 }]);
  assert.deepEqual(out.paths, [{ bot: 'gptbot', path: '/', requests: 4 }]);
  assert.deepEqual(out.notFound, [{ path: '/wp-login.php', requests: 7 }]);
  assert.deepEqual(crawlerTotals(out.days).map((t) => [t.bot.id, t.requests, t.lastSeen]), [['gptbot', 8, '2026-11-19']]);
});

test('crawlerQuery escapes matches into an OR filter', () => {
  const q = crawlerQuery(['GPTBot', 'Claude"Bot']);
  assert.match(q, /OR: \[\{ userAgent_like: "%GPTBot%" \}, \{ userAgent_like: "%Claude\\"Bot%" \}\]/);
});

test('client surfaces GraphQL and REST errors', async () => {
  const fake = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;
  await assert.rejects(createCfClient('t', fake({ data: null, errors: [{ message: 'zone not found' }] })).graphql('q', {}), /zone not found/);
  await assert.rejects(createCfClient('t', fake({ success: false, errors: [{ message: 'Authentication error' }] }, 403)).rest('/zones'), /Authentication error/);
  assert.deepEqual(await createCfClient('t', fake({ success: true, result: [1] })).rest('/zones'), [1]);
});

test('edgeCoverage reads proxying for the apex and www only', () => {
  const records = [
    { name: 'alwaysreadyrepair.com', type: 'A', content: '198.202.211.1', proxied: false },
    { name: 'www.alwaysreadyrepair.com', type: 'CNAME', content: 'cdn.webflow.com', proxied: false },
    { name: 'pricing.alwaysreadyrepair.com', type: 'A', content: '192.0.2.1', proxied: true },
    { name: 'alwaysreadyrepair.com', type: 'MX', content: 'mail', proxied: false }
  ];
  const dnsOnly = edgeCoverage(records, 'alwaysreadyrepair.com');
  assert.equal(dnsOnly.proxied, false);
  assert.deepEqual(dnsOnly.hosts.map((h) => h.name), ['alwaysreadyrepair.com', 'www.alwaysreadyrepair.com']);
  assert.match(edgeGap(dnsOnly)!, /alwaysreadyrepair\.com and www\.alwaysreadyrepair\.com are DNS-only.*198\.202\.211\.1, cdn\.webflow\.com/);

  const proxied = edgeCoverage(records.map((r) => ({ ...r, proxied: true })), 'alwaysreadyrepair.com');
  assert.equal(proxied.proxied, true);
  assert.equal(edgeGap(proxied), null);
  // Mixed: www proxied, apex not. Partial coverage still warrants the note, naming only the direct host.
  const mixed = edgeCoverage(records.map((r) => (r.name.startsWith('www.') ? { ...r, proxied: true } : r)), 'alwaysreadyrepair.com');
  assert.equal(mixed.proxied, false);
  assert.match(edgeGap(mixed)!, /^alwaysreadyrepair\.com is DNS-only/);
  assert.equal(edgeCoverage([], 'x.com').proxied, null);
  assert.equal(edgeGap(null), null);
});

test('reviewEdge only overrides in mock mode', () => {
  const edge = { proxied: true, hosts: [{ name: 'a.com', proxied: true, target: 'o' }] };
  const url = new URL('http://h/traffic?edge=dns-only');
  assert.equal(reviewEdge(edge, 'mock', url)!.proxied, false);
  assert.equal(reviewEdge(edge, 'snapshot', url), edge);
});
