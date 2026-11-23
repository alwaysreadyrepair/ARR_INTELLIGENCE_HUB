import test from 'node:test';
import assert from 'node:assert/strict';
import { httpUrl } from './url.ts';

test('only http(s) links survive', () => {
  assert.equal(httpUrl('https://a.example/x'), 'https://a.example/x');
  for (const bad of ['javascript://alwaysreadyrepair.com/%0aalert(1)', 'data:text/html,x', '/x', '', null, undefined]) assert.equal(httpUrl(bad), undefined);
});
