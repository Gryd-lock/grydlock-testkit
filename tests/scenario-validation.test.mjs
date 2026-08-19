import { test } from 'node:test';
import assert from 'node:assert/strict';

import { validateScenario } from '../scripts/lib/scenario.mjs';
import { scenario, loadContext, hasIssue, IDS } from './helpers.mjs';

const context = loadContext();

function issuesFor(overrides) {
  return validateScenario(scenario(overrides), context).issues;
}

// ---------------------------------------------------------------------------
// Valid scenarios
// ---------------------------------------------------------------------------

test('valid: minimal scenario passes', () => {
  assert.deepEqual(issuesFor({}), []);
});

test('valid: multiple participants pass', () => {
  const issues = issuesFor({
    participants: [
      { id: 'victim', destination: IDS.cleanVictim },
      { id: 'attacker', destination: IDS.maliciousDrainer }
    ],
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim', 'attacker'],
        expected_warnings: [{ risk_pattern: 'phishing-drainer', expected: true }],
        expected_state: [
          { participant: 'victim', tier: 'malicious' },
          { participant: 'attacker', tier: 'malicious' }
        ]
      }
    ]
  });
  assert.deepEqual(issues, []);
});

test('valid: multiple destinations pass', () => {
  const issues = issuesFor({
    steps: [
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
        transaction: 'path_payment',
        destination: IDS.suspiciousPassThrough,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'pass-through', expected: true }],
        expected_state: [{ participant: 'victim', tier: 'suspicious' }]
      }
    ]
  });
  assert.deepEqual(issues, []);
});

test('valid: multiple ordered transactions pass', () => {
  const issues = issuesFor({
    steps: [
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
        transaction: 'change_trust',
        destination: IDS.suspiciousTrustline,
        participants: ['victim'],
        expected_warnings: [{ risk_pattern: 'scam-trustline', expected: true }],
        expected_state: [{ participant: 'victim', tier: 'suspicious' }]
      }
    ]
  });
  assert.deepEqual(issues, []);
});

test('valid: expected warnings (expected + not expected) pass', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.maliciousDrainer,
        participants: ['victim'],
        expected_warnings: [
          { risk_pattern: 'phishing-drainer', expected: true, severity: 'malicious' },
          { risk_pattern: 'sweep', expected: false }
        ],
        expected_state: [{ participant: 'victim', tier: 'malicious' }]
      }
    ]
  });
  assert.deepEqual(issues, []);
});

// ---------------------------------------------------------------------------
// Invalid / malformed / unknown references
// ---------------------------------------------------------------------------

test('invalid: missing participant reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'participants', reason: 'must be an array' }));
});

test('invalid: missing destination reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'destination', reason: 'is required (missing)' }));
});

test('invalid: missing transaction reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'transaction', reason: 'is required (missing)' }));
});

test('invalid: unknown participant reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: ['ghost'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'participants[0]', value: 'ghost', reason: 'participant was not found' }));
});

test('invalid: unknown destination reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: 'GUNKNOWNDESTINATION0000000000000000000000000000000000',
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'destination', reason: 'was not found' }));
});

test('invalid: unknown transaction reference fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'does_not_exist',
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'transaction', value: 'does_not_exist', reason: 'was not found' }));
});

test('invalid: malformed participant reference (non-string) fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: [123],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'participants[0]', reason: 'malformed participant reference' }));
});

test('invalid: malformed destination reference (empty string) fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: '',
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'destination', reason: 'malformed reference' }));
});

test('invalid: malformed transaction reference (non-string) fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 42,
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'transaction', reason: 'malformed reference' }));
});

test('invalid: participant entry with unknown destination fails', () => {
  const issues = issuesFor({
    participants: [{ id: 'victim', destination: 'GUNKNOWNDESTINATION0000000000000000000000000000000000' }]
  });
  assert.ok(hasIssue(issues, { field: 'participants[0].destination', reason: 'was not found' }));
});

test('invalid: duplicate participant id fails', () => {
  const issues = issuesFor({
    participants: [
      { id: 'victim', destination: IDS.cleanVictim },
      { id: 'victim', destination: IDS.cleanWallet2 }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'participants[1].id', reason: 'duplicate participant id' }));
});

// ---------------------------------------------------------------------------
// Ordering
// ---------------------------------------------------------------------------

function twoSteps(step2) {
  return {
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      },
      step2
    ]
  };
}

test('ordering: duplicate step id fails', () => {
  const issues = issuesFor(
    twoSteps({
      id: 'step-1',
      sequence: 2,
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    })
  );
  assert.ok(hasIssue(issues, { field: 'steps[1].id', reason: 'duplicate step id' }));
});

test('ordering: duplicate sequence number fails', () => {
  const issues = issuesFor(
    twoSteps({
      id: 'step-2',
      sequence: 1,
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    })
  );
  assert.ok(hasIssue(issues, { field: 'sequence', reason: 'duplicate sequence number' }));
});

test('ordering: missing sequence fails', () => {
  const issues = issuesFor(
    twoSteps({
      id: 'step-2',
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    })
  );
  assert.ok(hasIssue(issues, { field: 'sequence', reason: 'is required (missing ordering information)' }));
});

test('ordering: invalid (non-integer) sequence fails', () => {
  const issues = issuesFor(
    twoSteps({
      id: 'step-2',
      sequence: 1.5,
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    })
  );
  assert.ok(hasIssue(issues, { field: 'sequence', reason: 'must be an integer' }));
});

test('ordering: non-positive sequence fails', () => {
  const issues = issuesFor(
    twoSteps({
      id: 'step-2',
      sequence: 0,
      transaction: 'payment',
      destination: IDS.cleanVictim,
      participants: ['victim'],
      expected_warnings: [],
      expected_state: [{ participant: 'victim', tier: 'clean' }]
    })
  );
  assert.ok(hasIssue(issues, { field: 'sequence', reason: 'must be a positive integer' }));
});

// ---------------------------------------------------------------------------
// Incomplete scenarios
// ---------------------------------------------------------------------------

test('incomplete: missing required metadata (id) fails', () => {
  const issues = issuesFor({ id: undefined });
  assert.ok(hasIssue(issues, { field: 'id', reason: 'is required' }));
});

test('incomplete: missing required metadata (name) fails', () => {
  const issues = issuesFor({ name: '' });
  assert.ok(hasIssue(issues, { field: 'name', reason: 'is required' }));
});

test('incomplete: empty scenario (no participants) fails', () => {
  const issues = issuesFor({ participants: [] });
  assert.ok(hasIssue(issues, { field: 'participants', reason: 'at least one participant' }));
});

test('incomplete: empty steps fails', () => {
  const issues = issuesFor({ steps: [] });
  assert.ok(hasIssue(issues, { field: 'steps', reason: 'at least one step' }));
});

test('incomplete: incomplete transaction step (missing transaction) fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'transaction', reason: 'is required (missing)' }));
});

test('incomplete: missing expected outcome fails', () => {
  const issues = issuesFor({
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: []
      }
    ]
  });
  assert.ok(hasIssue(issues, { field: 'expected outcome', reason: 'is missing' }));
});

// ---------------------------------------------------------------------------
// Versioning
// ---------------------------------------------------------------------------

test('versioning: supported version passes', () => {
  assert.deepEqual(issuesFor({ schema_version: '1.0' }), []);
});

test('versioning: unsupported version fails', () => {
  const issues = issuesFor({ schema_version: '2.0' });
  assert.ok(hasIssue(issues, { field: 'schema_version', value: '2.0', reason: 'is unsupported' }));
});

test('versioning: malformed version (non-string) fails', () => {
  const issues = issuesFor({ schema_version: 1 });
  assert.ok(hasIssue(issues, { field: 'schema_version', reason: 'is malformed' }));
});

test('versioning: missing version fails', () => {
  const { schema_version, ...rest } = scenario({});
  const issues = validateScenario(rest, context).issues;
  assert.ok(hasIssue(issues, { field: 'schema_version', reason: 'is required (missing)' }));
});

test('versioning: unsupported version is not silently interpreted', () => {
  const issues = issuesFor({ schema_version: '99.0' });
  const versionIssue = issues.find((i) => i.field === 'schema_version');
  assert.ok(versionIssue);
  assert.match(versionIssue.reason, /unsupported/);
  assert.match(versionIssue.reason, /1\.0/);
});
