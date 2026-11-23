/* What must be true of an environment in wrangler.json before it may be deployed. */
interface EnvConfig { vars?: Record<string, string>; kv_namespaces?: { binding: string; id: string }[]; workers_dev?: boolean; preview_urls?: boolean; routes?: { pattern: string }[] }

export function deployProblems(config: { env?: Record<string, EnvConfig> }, name: string): string[] {
  const e = config.env?.[name];
  if (!e) return [`wrangler.json has no "${name}" environment.`];
  const out: string[] = [];
  const bad = (v: string | undefined) => !v || v === 'local' || v.includes('REPLACE');
  if (e.workers_dev !== false || e.preview_urls !== false) out.push('workers_dev and preview_urls must be false, or the Hub is reachable outside its hostname.');
  if (!e.routes?.length || e.routes.some((r) => bad(r.pattern))) out.push('Set the hostname in routes.');
  for (const k of ['SUPABASE_URL', 'SUPABASE_PUBLISHABLE_KEY']) if (bad(e.vars?.[k])) out.push(`Set ${k}.`);
  if (!bad(e.vars?.SUPABASE_PUBLISHABLE_KEY) && !e.vars!.SUPABASE_PUBLISHABLE_KEY!.startsWith('sb_publishable_')) out.push('SUPABASE_PUBLISHABLE_KEY must start with sb_publishable_.');
  if (Object.values(e.vars ?? {}).some((v) => v.startsWith('sb_secret_') || v.startsWith('eyJ'))) out.push('A secret key or token is in vars. Remove and rotate it.');
  if (Object.keys(e.vars ?? {}).some((k) => ['AUTH_MODE', 'HIDE_MOCK'].includes(k))) out.push('AUTH_MODE and HIDE_MOCK are for local dev only.');
  for (const b of ['SEO', 'TRAFFIC']) if (bad(e.kv_namespaces?.find((k) => k.binding === b)?.id)) out.push(`Set the ${b} KV namespace id.`);
  return out;
}
