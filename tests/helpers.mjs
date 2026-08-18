import { fileURLToPath } from 'node:url';
import { loadDestinations, loadTransactionIndex } from '../scripts/lib/scenario.mjs';

export const root = fileURLToPath(new URL('..', import.meta.url));

export function loadContext() {
  return {
    destinations: loadDestinations(root),
    transactions: loadTransactionIndex(root)
  };
}

// Well-known, already-existing fixture ids used across the tests.
export const IDS = {
  cleanVictim: 'GCRRYBV5IY7DSI54DKW33ZELC2LWYCAHC43TXAM2A2HTFN5GWOFWXPC2',
  cleanWallet2: 'GA4HFFSHZ7PADQWOFCZGYV2HE437LQ2WDILWCGC33BMJUQ6OBO5HKI5D',
  suspiciousPassThrough: 'GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J',
  suspiciousTrustline: 'GCHYSQ57SVW6LFLGLQ4P77ZDQJ7BPQIM3QOCPIBIZKXGZGAQMJQZRFMS',
  maliciousDrainer: 'GCAMGLMB5EN55ICM26RYDGZSE5P4GKMK6TD6ZB7LACMVE7IEDTWVYZDF',
  maliciousSweep: 'GD7XPB2A7CG5Z4ICV24B3LXCRHAEJRFEK4OEW3ZIOQAPJOHAXBB7QHGE'
};

// Builds a minimal but complete, valid scenario. Pass overrides to mutate a
// specific field (shallow merge; replace `steps`/`participants` wholesale).
export function scenario(overrides = {}) {
  return {
    schema_version: '1.0',
    id: 'phishing-drain-01',
    name: 'Test scenario',
    participants: [{ id: 'victim', destination: IDS.cleanVictim }],
    steps: [
      {
        id: 'step-1',
        sequence: 1,
        transaction: 'payment',
        destination: IDS.cleanVictim,
        participants: ['victim'],
        expected_warnings: [],
        expected_state: [{ participant: 'victim', tier: 'clean' }]
      }
    ],
    ...overrides
  };
}

// Returns true if any issue matches all provided predicates.
export function hasIssue(issues, match) {
  return issues.some((issue) => {
    for (const [key, expected] of Object.entries(match)) {
      if (expected === null || expected === undefined) {
        if (issue[key] !== expected) return false;
      } else if (typeof expected === 'string') {
        if (!String(issue[key]).includes(expected)) return false;
      } else if (expected instanceof RegExp) {
        if (!expected.test(String(issue[key]))) return false;
      } else if (issue[key] !== expected) {
        return false;
      }
    }
    return true;
  });
}
