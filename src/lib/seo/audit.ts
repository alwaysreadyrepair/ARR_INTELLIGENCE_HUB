/* Site-audit checks for one fetched page, plus robots.txt and sitemap parsing. Pure functions over strings, so
 * they're unit-tested and the crawl itself (scripts/seo-refresh.ts) stays a thin fetch loop.
 *
 * These are a small, opinionated subset of what OpenSEO's audit worker checks: the things that keep a local
 * service business's pages from being understood by Google and quoted by AI answer engines. Regex over HTML is
 * deliberate: the checks only need tags in <head> and counts, not a DOM. */

import type { AuditIssue, AuditPage } from '../../domain/seo.ts';

/** User agents of the AI crawlers that matter for answer engines. */
export const AI_BOTS = ['GPTBot', 'OAI-SearchBot', 'ChatGPT-User', 'PerplexityBot', 'ClaudeBot', 'Claude-SearchBot', 'Google-Extended', 'Applebot-Extended', 'CCBot'];

const issue = (code: string, severity: AuditIssue['severity'], message: string, aeo = false): AuditIssue => ({ code, severity, message, aeo });

const decode = (s: string) =>
  s.replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ').trim();

function metaContent(html: string, name: string): string | null {
  for (const tag of html.match(/<meta\b[^>]*>/gi) ?? []) {
    const key = tag.match(/\b(?:name|property)\s*=\s*["']([^"']+)["']/i)?.[1];
    if (key?.toLowerCase() === name) return decode(tag.match(/\bcontent\s*=\s*["']([^"']*)["']/i)?.[1] ?? '');
  }
  return null;
}

/** @type values from every JSON-LD block, including inside @graph and arrays. Unparseable blocks are reported. */
export function schemaTypes(html: string): { types: string[]; invalid: number } {
  const types = new Set<string>();
  let invalid = 0;
  const walk = (node: unknown) => {
    if (Array.isArray(node)) return node.forEach(walk);
    if (!node || typeof node !== 'object') return;
    const t = (node as Record<string, unknown>)['@type'];
    for (const v of Array.isArray(t) ? t : [t]) if (typeof v === 'string') types.add(v);
    for (const v of Object.values(node)) if (v && typeof v === 'object') walk(v);
  };
  for (const m of html.matchAll(/<script\b[^>]*type\s*=\s*["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try {
      walk(JSON.parse(m[1]!));
    } catch {
      invalid++;
    }
  }
  return { types: [...types].sort(), invalid };
}

/** Visible body words: strips scripts, styles, nav/header/footer chrome and tags. */
export function wordCount(html: string): number {
  const body = html.match(/<body\b[^>]*>([\s\S]*)<\/body>/i)?.[1] ?? html;
  const text = body
    .replace(/<(script|style|noscript|svg|nav|header|footer|template)\b[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ');
  return decode(text).split(' ').filter((w) => /[\p{L}\p{N}]/u.test(w)).length;
}

const LOCAL_BUSINESS = /^(LocalBusiness|HVACBusiness|HomeAndConstructionBusiness|Plumber|Electrician|ProfessionalService|Organization)$/;

export function auditPage(url: string, status: number, html: string, opts: { home?: boolean } = {}): AuditPage {
  const issues: AuditIssue[] = [];
  const page: AuditPage = { url, status, title: null, metaDescription: null, h1Count: 0, wordCount: 0, canonical: null, noindex: false, schemaTypes: [], issues };
  if (status >= 400) {
    issues.push(issue('http-error', 'high', `Returns HTTP ${status}.`));
    return page;
  }
  if (status >= 300) {
    issues.push(issue('redirect', 'low', `Redirects (HTTP ${status}). Link to the final URL instead.`));
    return page;
  }
  const head = html.match(/<head\b[^>]*>([\s\S]*?)<\/head>/i)?.[1] ?? html;
  const title = head.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1];
  page.title = title == null ? null : decode(title) || null;
  page.metaDescription = metaContent(head, 'description') || null;
  page.h1Count = (html.match(/<h1\b/gi) ?? []).length;
  page.wordCount = wordCount(html);
  page.canonical = head.match(/<link\b[^>]*rel\s*=\s*["']canonical["'][^>]*>/i)?.[0].match(/href\s*=\s*["']([^"']+)["']/i)?.[1] ?? null;
  const robots = (metaContent(head, 'robots') ?? '').toLowerCase();
  page.noindex = robots.includes('noindex');
  const schema = schemaTypes(html);
  page.schemaTypes = schema.types;
  // FAQ-style blocks: <details> accordions or elements whose class names them as an FAQ. Headings ending in "?"
  // aren't enough on their own: on a real site most of them are blog-card titles.
  const hasQuestions = /<details\b/i.test(html) || /\bclass\s*=\s*["'][^"']*\bfaqs?\b/i.test(html);

  if (!page.title) issues.push(issue('title-missing', 'high', 'No <title>. Google writes its own.'));
  else if (page.title.length > 60) issues.push(issue('title-too-long', 'low', 'Title is over 60 characters and will be cut off in results.'));
  else if (page.title.length < 20) issues.push(issue('title-too-short', 'low', 'Title is under 20 characters; it can name the service and the city.'));
  if (!page.metaDescription) issues.push(issue('meta-description-missing', 'medium', 'No meta description. Google and AI engines write their own summary.'));
  else if (page.metaDescription.length > 160) issues.push(issue('meta-description-long', 'low', 'Meta description is over 160 characters and will be cut off.'));
  if (page.h1Count === 0) issues.push(issue('h1-missing', 'medium', 'No H1 heading.'));
  else if (page.h1Count > 1) issues.push(issue('h1-multiple', 'low', `${page.h1Count} H1 headings; one states the page's topic most clearly.`));
  if (page.noindex) issues.push(issue('noindex', 'high', 'Marked noindex: Google and AI search will drop it.'));
  if (!page.canonical) issues.push(issue('canonical-missing', 'low', 'No canonical link.'));
  if (schema.invalid) issues.push(issue('schema-invalid', 'high', `${schema.invalid} structured-data block${schema.invalid > 1 ? 's' : ''} can't be parsed as JSON.`, true));
  if (opts.home && !page.schemaTypes.some((t) => LOCAL_BUSINESS.test(t))) issues.push(issue('no-business-schema', 'high', 'Homepage has no LocalBusiness/HVACBusiness structured data (name, address, phone, hours, area served).', true));
  if (hasQuestions && !page.schemaTypes.includes('FAQPage')) issues.push(issue('faq-without-schema', 'medium', 'Has question-and-answer content but no FAQPage structured data. That content is what AI answers quote.', true));
  if (page.wordCount < 300) issues.push(issue('thin-content', 'medium', `Only ${page.wordCount} words of body text. Thin pages rarely get quoted.`, true));
  // Tracking pixels (1×1, hidden, or inside <noscript>) aren't content images.
  const visible = html.replace(/<noscript\b[\s\S]*?<\/noscript>/gi, '');
  const noAlt = (visible.match(/<img\b(?![^>]*\balt\s*=)[^>]*>/gi) ?? []).filter((t) => !/\b(?:width|height)\s*=\s*["']?1\b|display\s*:\s*none/i.test(t)).length;
  if (noAlt) issues.push(issue('images-missing-alt', 'low', `${noAlt} image${noAlt > 1 ? 's have' : ' has'} no alt text.`));
  if (!metaContent(head, 'og:title')) issues.push(issue('og-missing', 'low', 'No Open Graph tags; shared links show no preview.'));
  return page;
}

/** Which AI crawlers robots.txt blocks from the whole site, and whether it lists a sitemap. */
export function parseRobots(txt: string): { blockedAiBots: string[]; sitemaps: string[] } {
  const groups: { agents: string[]; disallowAll: boolean; allowAll: boolean }[] = [];
  let cur: { agents: string[]; disallowAll: boolean; allowAll: boolean } | null = null;
  let lastWasAgent = false;
  const sitemaps: string[] = [];
  for (const raw of txt.split(/\r?\n/)) {
    const line = raw.replace(/#.*/, '').trim();
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1]!.toLowerCase(), val = m[2]!.trim();
    if (key === 'sitemap') sitemaps.push(val);
    else if (key === 'user-agent') {
      if (!cur || !lastWasAgent) groups.push((cur = { agents: [], disallowAll: false, allowAll: false }));
      cur.agents.push(val.toLowerCase());
      lastWasAgent = true;
      continue;
    } else if (cur && key === 'disallow' && val === '/') cur.disallowAll = true;
    else if (cur && key === 'allow' && val === '/') cur.allowAll = true;
    lastWasAgent = false;
  }
  // A bot follows its own group if it has one, else the * group.
  const blocked = AI_BOTS.filter((bot) => {
    const own = groups.find((g) => g.agents.includes(bot.toLowerCase()));
    const g = own ?? groups.find((x) => x.agents.includes('*'));
    return !!g && g.disallowAll && !g.allowAll;
  });
  return { blockedAiBots: blocked, sitemaps };
}

/** <loc> URLs from a sitemap or sitemap index. */
export function parseSitemap(xml: string): { urls: string[]; isIndex: boolean } {
  const urls = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1]!));
  return { urls, isIndex: /<sitemapindex\b/i.test(xml) };
}
