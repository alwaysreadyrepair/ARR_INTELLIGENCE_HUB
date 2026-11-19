/* Does an AI answer name or cite a brand? Ported from OpenSEO (github.com/every-app/open-seo, MIT, © 2026 Ben
 * Senescu): server/features/ai-visibility/services/aiVisibilityMatching.ts and providers/dataforseoEvidence.ts at
 * commit 672a66c. Changes: no zod/remeda/tldts, one brand list per answer, and a mention order across brands.
 *
 * A brand is *mentioned* when one of its names (or its domain) appears in the answer prose, as a whole word, and
 * *cited* when the answer links to a page on its domain. Citation pills like [1] or [example.com] are evidence of a
 * source, not a mention, so they are stripped before matching. */

import type { SeoBrand } from '../../domain/seo.ts';

export interface AiCitation {
  url: string;
  domain: string;
  title: string | null;
}

export interface ParsedAiAnswer {
  /** Plain prose for matching; empty when the engine gave no answer. */
  text: string;
  citations: AiCitation[];
}

/** Plain answer prose. Removes images, citation pills, emphasis markers, heading and list markers. */
export function markdownToText(markdown: string): string {
  return markdown
    .replaceAll('\0', '')
    .replace(/!\[[^\]]*\]\([^)\s]*\)/g, '')
    .replace(/\[((?:[^[\]]|\[[^\]]*\])*)\]\((https?:\/\/[^)\s]+)\)/g, (_, label: string, url: string) => (citationPill(label, url) ? '' : label))
    .replace(/\*\*|__|`/g, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^(\s*)[*+-]\s+/gm, '$1');
}

function citationPill(label: string, url: string): boolean {
  const text = label.replace(/^\[|\]$/g, '').trim().toLowerCase();
  if (/^\d+$/.test(text)) return true;
  try {
    return text.replace(/^www\./, '') === new URL(url).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
}

/** Safe, de-duplicated http(s) citations with tracking parameters removed. Accepts any list of { url, title? }. */
export function citationsFrom(list: unknown[]): AiCitation[] {
  const out = new Map<string, AiCitation>();
  for (const item of list) {
    if (!item || typeof item !== 'object') continue;
    const raw = (item as { url?: unknown }).url;
    const title = (item as { title?: unknown }).title;
    if (typeof raw !== 'string') continue;
    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      continue;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') continue;
    url.hash = '';
    for (const key of Array.from(url.searchParams.keys())) {
      if (/^utm_/i.test(key) || ['gclid', 'fbclid', 'msclkid'].includes(key.toLowerCase())) url.searchParams.delete(key);
    }
    const href = url.toString();
    if (out.has(href)) continue;
    out.set(href, { url: href, domain: url.hostname.toLowerCase().replace(/^www\./, ''), title: typeof title === 'string' ? title.replaceAll('\0', '') : null });
  }
  return [...out.values()];
}

/** True when `hostname` is `domain` or one of its subdomains. */
export function ownedDomain(hostname: string, domain: string): boolean {
  const host = hostname.toLowerCase().replace(/^www\./, '');
  const d = domain.toLowerCase().replace(/^www\./, '');
  return !!d && (host === d || host.endsWith(`.${d}`));
}

/** Character spans where any of `names` appears as a whole word. URLs and emails don't count as mentions. Spans
 *  index into the original text. Overlapping matches keep the longest. */
export function mentionSpans(text: string, names: string[]): { start: number; end: number }[] {
  // Blank out URLs/emails but keep their length, so offsets still address the original text.
  const prose = text.replace(/(?:https?:\/\/|www\.)[^\s<>]+|[\p{L}\p{N}._%+-]+@[\p{L}\p{N}.-]+\.[\p{L}]{2,}/giu, (v) => ' '.repeat(v.length));
  // Match canonically equivalent Unicode without losing the original UTF-16 offsets.
  let normalized = '';
  const starts: number[] = [], ends: number[] = [];
  let offset = 0;
  for (const ch of prose) {
    const dec = ch.normalize('NFD');
    normalized += dec;
    for (let i = 0; i < dec.length; i++) {
      starts.push(offset);
      ends.push(offset + ch.length);
    }
    offset += ch.length;
  }
  const found = new Map<string, { start: number; end: number }>();
  for (const name of new Set(names.map((n) => n.trim()).filter((n) => n.length >= 2))) {
    const escaped = name.normalize('NFD').replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
    const pattern = new RegExp(`(?<![\\p{L}\\p{M}\\p{N}_])${escaped}(?![\\p{L}\\p{M}\\p{N}_])`, 'giu');
    for (const m of normalized.matchAll(pattern)) {
      const start = starts[m.index]!, end = ends[m.index + m[0].length - 1]!;
      found.set(`${start}:${end}`, { start, end });
    }
  }
  const sorted = [...found.values()].sort((a, b) => a.start - b.start || b.end - a.end);
  return sorted.filter((s, i) => !sorted.slice(0, i).some((o) => o.start <= s.start && o.end >= s.end));
}

/** "acme-heating.com" → "acme-heating". Only for a bare registrable-looking domain. */
function domainStem(domain: string): string | null {
  const parts = domain.toLowerCase().replace(/^www\./, '').split('.');
  return parts.length === 2 ? parts[0]! : null;
}

/** The strings an answer might use for a brand: its names and its domain. */
export function brandNames(b: Pick<SeoBrand, 'names' | 'name' | 'domain'>): string[] {
  const stem = domainStem(b.domain);
  // A stem like "alwaysreadyrepair" is safe to match; a short one would not be.
  return [...new Set([b.name, ...b.names, b.domain, ...(stem && stem.length >= 8 ? [stem] : [])])];
}

export interface BrandMatch {
  domain: string;
  mentioned: boolean;
  cited: boolean;
  firstMention: number | null;
}

export function matchBrand(answer: ParsedAiAnswer, brand: Pick<SeoBrand, 'names' | 'name' | 'domain'>): BrandMatch {
  const spans = mentionSpans(answer.text, brandNames(brand));
  return {
    domain: brand.domain,
    mentioned: spans.length > 0,
    cited: answer.citations.some((c) => ownedDomain(c.domain, brand.domain)),
    firstMention: spans[0]?.start ?? null
  };
}

/** Match ARR and every competitor against one answer. `mentionRank` is ARR's 1-based order among the named brands. */
export function matchAnswer(answer: ParsedAiAnswer, own: SeoBrand, competitors: SeoBrand[]) {
  const us = matchBrand(answer, own);
  const them = competitors.map((c) => matchBrand(answer, c)).filter((m) => m.mentioned);
  const order = [us, ...them].filter((m) => m.firstMention != null).sort((a, b) => a.firstMention! - b.firstMention!);
  const rank = us.mentioned ? order.findIndex((m) => m.domain === own.domain) + 1 : null;
  return {
    answered: answer.text.trim().length > 0,
    mentioned: us.mentioned,
    cited: us.cited,
    mentionRank: rank,
    competitorsMentioned: them.map((m) => m.domain),
    citedDomains: [...new Set(answer.citations.map((c) => c.domain))],
    excerpt: excerpt(answer.text, us.firstMention)
  };
}

/** About 400 characters around `at` (or from the start), cut on word boundaries. */
export function excerpt(text: string, at: number | null, size = 400): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  if (!clean) return '';
  if (clean.length <= size) return clean;
  // `at` indexes the original text; whitespace collapsing only moves it earlier, so it stays a fair anchor.
  const start = at == null ? 0 : Math.max(0, Math.min(at - 120, clean.length - size));
  let out = clean.slice(start, start + size);
  if (start > 0) out = `…${out.slice(out.indexOf(' ') + 1)}`;
  if (start + size < clean.length) out = `${out.slice(0, out.lastIndexOf(' '))}…`;
  return out;
}
