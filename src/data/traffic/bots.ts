/* Which crawlers and AI assistants the Web Traffic pages pick out. Data, not code: add a bot or an assistant here
 * and both the refresh query and the pages follow. User-Agent substrings come from each operator's published
 * crawler docs. Order matters for matching: the first `match` found in a User-Agent wins, so the more specific
 * strings (ChatGPT-User, OAI-SearchBot) come before broader ones. */

import type { AiAssistantDef, BotDef, BotPurpose } from '../../domain/traffic.ts';

export const BOTS: BotDef[] = [
  { id: 'chatgpt-user', label: 'ChatGPT-User', operator: 'OpenAI', purpose: 'user', match: 'ChatGPT-User' },
  { id: 'oai-searchbot', label: 'OAI-SearchBot', operator: 'OpenAI', purpose: 'ai-search', match: 'OAI-SearchBot' },
  { id: 'gptbot', label: 'GPTBot', operator: 'OpenAI', purpose: 'training', match: 'GPTBot' },
  { id: 'claude-user', label: 'Claude-User', operator: 'Anthropic', purpose: 'user', match: 'Claude-User' },
  { id: 'claude-searchbot', label: 'Claude-SearchBot', operator: 'Anthropic', purpose: 'ai-search', match: 'Claude-SearchBot' },
  { id: 'claudebot', label: 'ClaudeBot', operator: 'Anthropic', purpose: 'training', match: 'ClaudeBot' },
  { id: 'perplexity-user', label: 'Perplexity-User', operator: 'Perplexity', purpose: 'user', match: 'Perplexity-User' },
  { id: 'perplexitybot', label: 'PerplexityBot', operator: 'Perplexity', purpose: 'ai-search', match: 'PerplexityBot' },
  { id: 'google-cloudvertexbot', label: 'Google-CloudVertexBot', operator: 'Google', purpose: 'training', match: 'Google-CloudVertexBot' },
  { id: 'meta-externalagent', label: 'Meta-ExternalAgent', operator: 'Meta', purpose: 'training', match: 'meta-externalagent' },
  { id: 'applebot', label: 'Applebot', operator: 'Apple', purpose: 'ai-search', match: 'Applebot' },
  { id: 'amazonbot', label: 'Amazonbot', operator: 'Amazon', purpose: 'ai-search', match: 'Amazonbot' },
  { id: 'bytespider', label: 'Bytespider', operator: 'ByteDance', purpose: 'training', match: 'Bytespider' },
  { id: 'ccbot', label: 'CCBot', operator: 'Common Crawl', purpose: 'training', match: 'CCBot' },
  { id: 'duckassistbot', label: 'DuckAssistBot', operator: 'DuckDuckGo', purpose: 'ai-search', match: 'DuckAssistBot' },
  { id: 'googlebot', label: 'Googlebot', operator: 'Google', purpose: 'search-engine', match: 'Googlebot' },
  { id: 'bingbot', label: 'Bingbot', operator: 'Microsoft', purpose: 'search-engine', match: 'bingbot' }
];

export const PURPOSE_LABEL: Record<BotPurpose, string> = {
  training: 'Model training',
  'ai-search': 'AI search index',
  user: 'Live user request',
  'search-engine': 'Search engine'
};

export const PURPOSE_HELP: Record<BotPurpose, string> = {
  training: 'Collects pages to train future models. Doesn\'t send anyone to the site.',
  'ai-search': 'Indexes pages so AI answers can cite and link them.',
  user: 'Fetched a page because someone asked the assistant about it just now.',
  'search-engine': 'Classic search crawler, shown for scale.'
};

/** Referrers that mean a visitor came from an AI assistant's answer. */
export const AI_ASSISTANTS: AiAssistantDef[] = [
  { id: 'chatgpt', label: 'ChatGPT', hosts: ['chatgpt.com', 'chat.openai.com'] },
  { id: 'perplexity', label: 'Perplexity', hosts: ['perplexity.ai', 'www.perplexity.ai'] },
  { id: 'gemini', label: 'Gemini', hosts: ['gemini.google.com'] },
  { id: 'copilot', label: 'Copilot', hosts: ['copilot.microsoft.com'] },
  { id: 'claude', label: 'Claude', hosts: ['claude.ai'] }
];
