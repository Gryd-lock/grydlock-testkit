import { test } from 'node:test';
import assert from 'node:assert/strict';

import { replayScenario, sortSteps, ScenarioError } from '../scripts/lib/scenario.mjs';
import { scenario, loadContext, IDS } from './helpers.mjs';

const context = loadContext();

// ---------------------------------------------------------------------------
// Deterministic ordering
// ---------------------------------------------------------------------------

test('replay: steps execute in sequence order regardless of array order', () => {
  const steps = [
    {
      id: 'step-3',
      sequence: 3,
      transaction: 'path_payment',
      destination: IDS.maliciousDrainer,
      participants: ['victim'],
      expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true }],
      expected_state: [{ participant: 'victim', tier: 'malicious' }]
    },
    {
      id: 'step-1',
      sequence: 1,
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    },
    {
      id: 'step-2',
      sequence: 2,
      transaction: 'payment',
      destination: IDS.suspiciousPassThrough,
      participants: ['victim'],
      expected_warnings: [{ risk_pattern: 'pass-through', expected: true }],
      expected_state: [{ participant: 'victim', tier: 'suspicious' }]
    }
  ];

  const sorted = sortSteps(steps).map((s) => s.id);
  assert.deepEqual(sorted, ['step-1', 'step-2', 'step-3']);

  const report = replayScenario(scenario({ steps }), context);
  assert.deepEqual(report.steps.map((s) => s.id), ['step-1', 'step-2', 'step-3']);
  assert.deepEqual(report.finalState, { victim: 'malicious' });
});

test('replay: is deterministic across repeated runs', () => {
  const s = scenario({});
  const a = replayScenario(s, context);
  const b = replayScenario(s, context);
  assert.deepEqual(a, b);
});

// ---------------------------------------------------------------------------
// Successful replay
// ---------------------------------------------------------------------------

test('replay: successful multi-step scenario reports final state', () => {
  const report = replayScenario(
    scenario({
      participants: [
        { id: 'victim', destination: IDS.cleanVictim },
        { id: 'attacker', destination: IDS.maliciousDrainer }
      ],
      steps: [
        {
          id: 'fund',
          sequence: 1,
          transaction: 'payment',
          destination: IDS.cleanVictim,
          participants: ['victim'],
          expected_warnings: [],
          expected_state: [{ participant: 'victim', tier: 'clean' }]
        },
        {
          id: 'interact',
          sequence: 2,
          transaction: 'payment',
          destination: IDS.suspiciousPassThrough,
          participants: ['victim'],
          expected_warnings: [{ risk_pattern: 'pass-through', expected: true, severity: 'suspicious' }],
          expected_state: [{ participant: 'victim', tier: 'suspicious' }]
        },
        {
          id: 'drain',
          sequence: 3,
          transaction: 'path_payment',
          destination: IDS.maliciousDrainer,
          participants: ['victim', 'attacker'],
          expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true, severity: 'malicious' }],
          expected_state: [
            { participant: 'victim', tier: 'malicious' },
            { participant: 'attacker', tier: 'malicious' }
          ]
        }
      ]
    }),
    context
  );

  assert.equal(report.schemaVersion, '1.0');
  assert.deepEqual(report.finalState, { victim: 'malicious', attacker: 'malicious' });
  assert.deepEqual(report.steps[0].warnings, []);
  assert.deepEqual(report.steps[1].warnings, [{ risk_pattern: 'pass-through', severity: 'suspicious' }]);
  assert.deepEqual(report.steps[2].warnings, [{ risk_pattern: 'phishing-drainer', severity: 'malicious' }]);
  assert.deepEqual(report.steps[2].state, [
    { participant: 'victim', before: 'suspicious', after: 'malicious' },
    { participant: 'attacker', before: 'malicious', after: 'malicious' }
  ]);
});

// ---------------------------------------------------------------------------
// Outcome mismatches
// ---------------------------------------------------------------------------

test('outcome: expected warning != actual warning fails', () => {
  // Step touches a clean destination but expects a phishing-drainer warning.
  const s = scenario({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true }],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) =>
      err instanceof ScenarioError &&
      err.issues.some((i) => i.reason.includes('was expected but did not fire'))
  );
});

test('outcome: warning not expected but fired fails', () => {
  // Step touches a malicious destination but declares the warning as not expected.
  const s = scenario({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: false }],
        expected_state: [{ participant: 'victim', tier: 'malicious' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) =>
      err instanceof ScenarioError &&
      err.issues.some((i) => i.reason.includes('was not expected but fired'))
  );
});

test('outcome: unexpected warning fired fails', () => {
  // Step touches a malicious destination but declares no warnings at all.
  const s = scenario({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'malicious' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) =>
      err instanceof ScenarioError &&
      err.issues.some((i) => i.reason.includes('unexpected warning fired'))
  );
});

test('outcome: expected state != actual state fails', () => {
  // Victim touches a malicious destination but the author claims it stays clean.
  const s = scenario({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true }],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) =>
      err instanceof ScenarioError &&
      err.issues.some(
        (i) => i.reason.includes('expected tier "clean"') && i.reason.includes('actual tier is "malicious"')
      )
  );
});

test('outcome: warning severity mismatch fails', () => {
  const s = scenario({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true, severity: 'suspicious' }],
        expected_state: [{ participant: 'victim', tier: 'malicious' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) =>
      err instanceof ScenarioError &&
      err.issues.some((i) => i.reason.includes('expected severity "suspicious"') && i.reason.includes('actual severity is "malicious"'))
  );
});

test('outcome: replay fails deterministically on validation errors too', () => {
  const s = scenario({ steps: [{ id: 'step-1', sequence: 1 }] });
  assert.throws(
    () => replayScenario(s, context),
    (err) => err instanceof ScenarioError && err.title === 'Scenario validation failed:'
  );
});

test('error quality: names scenario, step, field, and reason', () => {
  const s = scenario({
    steps: [
      {
        id: 'drain-02',
        sequence: 1,
        transaction: 'payment',
        destination: 'attacker-destination',
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.throws(
    () => replayScenario(s, context),
    (err) => {
      assert.ok(err instanceof ScenarioError);
      assert.match(err.message, /scenario "phishing-drain-01"/);
      assert.match(err.message, /step "drain-02"/);
      assert.match(err.message, /destination "attacker-destination" was not found/);
      return true;
    }
  );
});
