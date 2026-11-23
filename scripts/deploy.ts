/* npm run deploy -- staging|production [--dry-run]
 * Checks the environment, runs tests, types and build, then deploys. --dry-run bundles without deploying. */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { deployProblems } from '../src/lib/deploy.ts';

const name = process.argv[2] ?? '';
const dry = process.argv.includes('--dry-run');
if (!['staging', 'production'].includes(name)) { console.error('Usage: npm run deploy -- staging|production [--dry-run]'); process.exit(1); }
const problems = deployProblems(JSON.parse(readFileSync('wrangler.json', 'utf8')), name);
if (problems.length) {
  console.error(`Not deploying ${name}:\n  ${problems.join('\n  ')}`);
  process.exit(1);
}
const run = (cmd: string, args: string[]) => execFileSync(cmd, args, { stdio: 'inherit', env: { ...process.env, CLOUDFLARE_ENV: name, NODE_ENV: 'production' } });
for (const s of ['test', 'check', 'build']) run('npm', ['run', s]);
run('npx', ['wrangler', 'deploy', ...(dry ? ['--dry-run'] : [])]);
