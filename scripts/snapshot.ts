/* Moves a snapshot between disk and a deployed KV namespace.
 *   npm run snapshot -- pull seo|traffic staging|production [--first-run]
 *   npm run snapshot -- push seo|traffic staging|production [--first-run | --rollback]
 * Pull records which environment and live version it came from; push refuses when either differs, so history can't be
 * overwritten by a stale or wrong-environment file. --rollback skips that check on purpose. Push copies live to a dated
 * key first. --first-run needs proof that no snapshot exists. KV has no compare-and-swap: two pushes in the same
 * second can still race. */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';

const [action, kind = '', env = '', ...flags] = process.argv.slice(2);
const fail = (m: string): never => { console.error(m); process.exit(1); };
if (!['pull', 'push'].includes(action ?? '') || !['seo', 'traffic'].includes(kind) || !['staging', 'production'].includes(env) || flags.some((f) => !['--first-run', '--rollback'].includes(f)))
  fail('Usage: npm run snapshot -- pull|push seo|traffic staging|production [--first-run|--rollback]');
const file = `.${kind}/snapshot.json`, stamp = `.${kind}/pulled.json`, key = `${kind}:snapshot`;
const kv = (...args: string[]) => execFileSync('npx', ['wrangler', 'kv', 'key', ...args, '--binding', kind.toUpperCase(), '--env', env, '--remote'], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'inherit'] });
const valid = (s: string) => { const j = JSON.parse(s) as { takenAt?: unknown }; if (typeof j.takenAt !== 'string') throw new Error('not a snapshot (no takenAt)'); return s; };
const hash = (s: string) => createHash('sha256').update(s).digest('hex');
const attempt = <T>(what: string, fn: () => T): T => { try { return fn(); } catch (e) { return fail(`${what}: ${e instanceof Error ? e.message : e}`); } };

const first = flags.includes('--first-run'), rollback = flags.includes('--rollback');
const keys = attempt('Could not list the namespace', () => JSON.parse(kv('list', '--prefix', key)) as { name: string }[]);
const exists = keys.some((k) => k.name === key);
if (first && exists) fail(`A live ${kind} snapshot already exists in ${env}. Run without --first-run.`);
if (!first && !exists) fail(`No live ${kind} snapshot in ${env}. Use --first-run if this is the first one.`);
const live = exists ? attempt(`Could not read the live ${kind} snapshot`, () => valid(kv('get', key))) : null;

if (action === 'pull') {
  mkdirSync(`.${kind}`, { recursive: true });
  if (live) writeFileSync(file, live); else rmSync(file, { force: true });
  writeFileSync(stamp, JSON.stringify({ env, live: live && hash(live) }));
  console.log(live ? `Pulled ${file} from ${env}` : `No live snapshot in ${env}; starting fresh.`);
} else {
  if (!existsSync(file)) fail(`${file} does not exist.`);
  const next = attempt(file, () => valid(readFileSync(file, 'utf8')));
  if (!rollback) {
    const from = existsSync(stamp) ? (JSON.parse(readFileSync(stamp, 'utf8')) as { env: string; live: string | null }) : fail('Pull first: there is no record of which live version this file builds on.');
    if (from.env !== env) fail(`This file was pulled from ${from.env}, not ${env}.`);
    if (from.live !== (live && hash(live))) fail(`The live ${env} snapshot changed since the pull. Pull and refresh again.`);
    if (live && next.length < live.length / 2) fail('The new snapshot is less than half the size of the live one. Not pushing.');
  }
  if (live) {
    const backup = `.${kind}/live-backup.json`;
    writeFileSync(backup, live);
    attempt('Could not back up the live snapshot', () => kv('put', `${kind}:backup:${new Date().toISOString()}`, '--path', backup, '--ttl', String(90 * 86_400)));
  }
  attempt('Push failed', () => kv('put', key, '--path', file));
  writeFileSync(stamp, JSON.stringify({ env, live: hash(next) }));
  console.log(`Pushed ${file} to ${env}`);
}
