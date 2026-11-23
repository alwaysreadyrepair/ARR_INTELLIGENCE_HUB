/* Claude answers straight from the Anthropic API, with web search on and the searcher placed in ARR's area. The
 * Claude counterpart of openai.ts: same prompt, no system prompt, so the answer is as close as the API gets to what
 * a homeowner would read in the Claude app.
 *
 * Only the refresh script calls this. Like every billed call in the refresh, it isn't retried (maxRetries: 0): a
 * prompt that fails is recorded as unanswered and the run goes on. */

import Anthropic from '@anthropic-ai/sdk';
import { citationsFrom, markdownToText, type ParsedAiAnswer } from './match.ts';
import { costOf, type DirectAnswer, type ModelPrice, type SearchLocation } from './openai.ts';

/** A long web-search turn can pause; this many requests is plenty for one short question. */
const MAX_TURNS = 4;

/** Credentials the SDK would pick up from the environment. An `ant auth login` profile also works, but only when
 *  ANTHROPIC_PROFILE names it, so the refresh doesn't switch to direct calls by accident. */
export const hasAnthropicCredentials = (env: Record<string, string | undefined>) =>
  !!(env.ANTHROPIC_API_KEY?.trim() || env.ANTHROPIC_AUTH_TOKEN?.trim() || env.ANTHROPIC_PROFILE?.trim());

export function claudeClient(): Anthropic {
  return new Anthropic({ maxRetries: 0, timeout: 180_000 });
}

/** Answer prose and the pages its sentences cite. Search results Claude read but didn't cite are left out, the same as
 *  a citation pill the app shows only for cited sources. */
export function parseClaudeContent(content: Anthropic.Beta.BetaContentBlock[]): ParsedAiAnswer {
  const texts = content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text');
  const cites = texts.flatMap((b) => b.citations ?? []).filter((c) => c.type === 'web_search_result_location');
  return { text: markdownToText(texts.map((b) => b.text).join('')), citations: citationsFrom(cites) };
}

/** One prompt, one answer. Server-side fallback is on, so a declined request is re-run on another Claude model inside
 *  the same call; `model` in the result is whichever model actually answered. A refusal from every model comes back
 *  as an empty, incomplete answer. */
export async function askClaude(
  client: Anthropic, model: string, prompt: string, where: SearchLocation, effort: 'low' | 'medium' | 'high', price: ModelPrice
): Promise<DirectAnswer> {
  const messages: Anthropic.Beta.BetaMessageParam[] = [{ role: 'user', content: prompt }];
  const content: Anthropic.Beta.BetaContentBlock[] = [];
  let inputTokens = 0, outputTokens = 0, searches = 0, served = model;
  let stop: Anthropic.Beta.BetaMessage['stop_reason'] = null;
  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const res = await client.beta.messages.create({
      model,
      max_tokens: 16000,
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      output_config: { effort },
      tools: [{
        type: 'web_search_20260209', name: 'web_search', max_uses: 5,
        user_location: { type: 'approximate', city: where.city, region: where.region, country: where.country, timezone: where.timezone }
      }],
      messages
    });
    inputTokens += res.usage.input_tokens + (res.usage.cache_creation_input_tokens ?? 0) + (res.usage.cache_read_input_tokens ?? 0);
    outputTokens += res.usage.output_tokens;
    searches += res.usage.server_tool_use?.web_search_requests ?? 0;
    content.push(...res.content);
    served = res.model;
    stop = res.stop_reason;
    // A paused server-tool turn resumes when the assistant turn is sent back as is.
    if (stop !== 'pause_turn') break;
    messages.push({ role: 'assistant', content: res.content });
  }
  const answer = stop === 'refusal' ? { text: '', citations: [] } : parseClaudeContent(content);
  return { ...answer, model: served, usd: costOf(price, inputTokens, outputTokens, searches), searches, complete: stop === 'end_turn' };
}
