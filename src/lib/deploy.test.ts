import test from 'node:test';
import assert from 'node:assert/strict';
import { deployProblems } from './deploy.ts';

const good = () => ({ name: 'hub', workers_dev: false, preview_urls: false, routes: [{ pattern: 'hub.example' }], vars: { SUPABASE_URL: 'https://x', SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_x' } as Record<string, string>, kv_namespaces: [{ binding: 'SEO', id: 'a1' }, { binding: 'TRAFFIC', id: 'b2' }] });
const check = (e: object) => deployProblems({ env: { production: e } }, 'production').length;

test('a complete environment passes; each gap blocks', () => {
  assert.equal(check(good()), 0);
  assert.equal(deployProblems({}, 'production').length, 1);
  assert.equal(check({ ...good(), name: 'arr-intelligence-hub' }), 1);
  assert.equal(check({ ...good(), name: undefined }), 1);
  assert.equal(check({ ...good(), workers_dev: true }), 1);
  assert.equal(check({ ...good(), routes: [{ pattern: 'REPLACE_ME' }] }), 1);
  assert.equal(check({ ...good(), vars: { ...good().vars, SUPABASE_URL: 'REPLACE_ME' } }), 1);
  assert.equal(check({ ...good(), vars: { ...good().vars, X: 'sb_secret_x' } }), 1);
  assert.equal(check({ ...good(), vars: { ...good().vars, SUPABASE_PUBLISHABLE_KEY: 'eyJservicerole' } }), 2);
  assert.equal(check({ ...good(), vars: { ...good().vars, HIDE_MOCK: 'false' } }), 1);
  assert.equal(check({ ...good(), kv_namespaces: [{ binding: 'SEO', id: 'local' }, { binding: 'TRAFFIC', id: 'b' }] }), 1);
});
