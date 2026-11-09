import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { renderCatalog } from '../scripts/render-catalog.mjs';
import { root } from './helpers.mjs';

test('docs/FIXTURES.md is up to date with the data (run `npm run docs`)', () => {
  const committed = readFileSync(join(root, 'docs/FIXTURES.md'), 'utf-8');
  assert.equal(committed, renderCatalog(root));
});
