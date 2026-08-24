import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { loadDestinations, loadTransactionIndex } from '../scripts/lib/scenario.mjs';
import { root, IDS } from './helpers.mjs';

// Regression guard: the scenario system is additive. Existing point fixtures
// (destinations.json, scores.json, transactions/*.xdr) must keep working
// exactly as before — none of them may be forced to become scenarios.

test('backward compat: destinations.json still parses with the existing shape', () => {
  const raw = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8'));
  assert.ok(Array.isArray(raw.destinations));
  assert.ok(raw.destinations.length >= 12);

  const byId = loadDestinations(root);
  for (const dest of raw.destinations) {
    assert.equal(typeof dest.id, 'string');
    assert.ok(['account', 'asset'].includes(dest.type));
    assert.ok(['clean', 'suspicious', 'malicious'].includes(dest.label));
    assert.equal(typeof dest.risk_pattern, 'string');
    assert.deepEqual(byId.get(dest.id), dest);
  }
});

test('backward compat: scores.json still maps every destination to a 0-100 number', () => {
  const scores = JSON.parse(readFileSync(join(root, 'scores.json'), 'utf-8'));
  const destinations = loadDestinations(root);

  for (const [id, score] of Object.entries(scores)) {
    assert.ok(destinations.has(id), `score entry "${id}" has no matching destination`);
    assert.ok(Number.isInteger(score), `score for "${id}" is not an integer`);
    assert.ok(score >= 0 && score <= 100, `score for "${id}" is out of range`);
  }
  for (const id of destinations.keys()) {
    assert.ok(id in scores, `destination "${id}" has no score entry`);
  }
});

test('backward compat: transaction XDR fixtures still load as single envelopes', () => {
  const transactions = loadTransactionIndex(root);
  assert.ok(transactions.has('payment'));
  assert.ok(transactions.has('path_payment'));
  assert.ok(transactions.has('change_trust'));

  for (const [stem, path] of transactions) {
    const xdr = readFileSync(path, 'utf-8').trim();
    assert.ok(xdr.length > 0, `${stem}.xdr is empty`);
    assert.doesNotThrow(() => Buffer.from(xdr, 'base64'), `${stem}.xdr is not valid base64`);
  }
});

test('backward compat: the scenario example only references existing fixtures', () => {
  const destinations = loadDestinations(root);
  const transactions = loadTransactionIndex(root);

  assert.ok(destinations.has(IDS.cleanVictim));
  assert.ok(destinations.has(IDS.suspiciousPassThrough));
  assert.ok(destinations.has(IDS.maliciousDrainer));
  assert.ok(transactions.has('payment'));
  assert.ok(transactions.has('path_payment'));
});

import { validateFixtureStatus } from '../scripts/validate-fixtures.mjs';

test('fixture status validation: accepts the supported synthetic status', () => {
  assert.equal(validateFixtureStatus({ fixture_status: 'synthetic-only' }), null);
});

test('fixture status validation: rejects a missing status', () => {
  assert.equal(validateFixtureStatus({}), 'missing fixture_status');
});

test('fixture status validation: rejects an unknown status', () => {
  assert.equal(
    validateFixtureStatus({ fixture_status: 'network-visible' }),
    'invalid fixture_status "network-visible"'
  );
});
