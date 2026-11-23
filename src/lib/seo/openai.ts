/* ChatGPT answers straight from OpenAI's Responses API, with web search on and the searcher placed in ARR's area.
 *
 * DataForSEO's LLM Responses gives one answer per prompt with no say over where the search runs from. Asking OpenAI
 * directly lets the refresh place the search in the south suburbs (local answers depend on it) and pick the model.
 * Only the refresh script calls this; billed calls are never retried, same rule as DataForSEO. */

import { citationsFrom, markdownToText, type ParsedAiAnswer } from './match.ts';

export const OPENAI_RESPONSES_URL = 'https://api.openai.com/v1/responses';

export interface SearchLocation {
  city: string;
  region: string;
  /** Two-letter ISO country code. */
  country: string;
  /** IANA time zone. */
  timezone: string;
}

/** Per-million-token prices and the per-search fee, for the cost the snapshot records. */
export interface ModelPrice {
  inputPerMTok: number;
  outputPerMTok: number;
  perSearch: number;
}

export interface DirectAnswer extends ParsedAiAnswer {
  model: string;
  usd: number;
  searches: number;
  /** False when the run stopped early (e.g. the output cap); the text may be cut short. */
  complete: boolean;
}

/** The request body: the prompt as a homeowner would type it, web search placed in our area. No system prompt, so
 *  the answer is as close as the API gets to what the ChatGPT app says. */
export function openAiRequest(model: string, prompt: string, where: SearchLocation, effort: 'low' | 'medium' | 'high') {
  return {
    model,
    input: prompt,
    tools: [{ type: 'web_search', user_location: { type: 'approximate', city: where.city, region: where.region, country: where.country, timezone: where.timezone } }],
    reasoning: { effort },
    max_output_tokens: 8000
  };
}

type Item = Record<string, unknown>;
const list = (v: unknown): Item[] => (Array.isArray(v) ? (v.filter((x) => x && typeof x === 'object') as Item[]) : []);
const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : 0);

/** Answer text, cited pages, token use and search count from a Responses API body. */
export function parseOpenAiResponse(body: unknown): { answer: ParsedAiAnswer; inputTokens: number; outputTokens: number; searches: number; complete: boolean } {
  const b = (body ?? {}) as Item;
  const output = list(b.output);
  const parts = output.filter((o) => o.type === 'message').flatMap((o) => list(o.content)).filter((c) => c.type === 'output_text');
  const md = parts.map((p) => (typeof p.text === 'string' ? p.text : '')).filter(Boolean).join('\n\n');
  const annotations = parts.flatMap((p) => list(p.annotations)).filter((a) => a.type === 'url_citation');
  const usage = (b.usage ?? {}) as Item;
  return {
    answer: { text: markdownToText(md), citations: citationsFrom(annotations) },
    inputTokens: n(usage.input_tokens),
    outputTokens: n(usage.output_tokens),
    searches: output.filter((o) => o.type === 'web_search_call').length,
    complete: b.status === 'completed'
  };
}

export const costOf = (price: ModelPrice, inputTokens: number, outputTokens: number, searches: number) =>
  Math.round(((inputTokens * price.inputPerMTok + outputTokens * price.outputPerMTok) / 1e6 + searches * price.perSearch) * 10000) / 10000;

/** One prompt, one answer. Throws with OpenAI's own message on an error status. */
export async function askOpenAi(
  apiKey: string, model: string, prompt: string, where: SearchLocation, effort: 'low' | 'medium' | 'high', price: ModelPrice, f: typeof fetch = fetch
): Promise<DirectAnswer> {
  const res = await f(OPENAI_RESPONSES_URL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(openAiRequest(model, prompt, where, effort)),
    signal: AbortSignal.timeout(180_000)
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string }; model?: string };
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${body.error?.message ?? 'request failed'}`);
  const p = parseOpenAiResponse(body);
  return { ...p.answer, model: typeof body.model === 'string' ? body.model : model, usd: costOf(price, p.inputTokens, p.outputTokens, p.searches), searches: p.searches, complete: p.complete };
}
