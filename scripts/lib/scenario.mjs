// Versioned scenario bundles for deterministic, offline, multi-transaction
// attack workflows.
//
// A scenario groups participants, destination/transaction references, and an
// ordered list of steps. Replay is purely synthetic: it does not decode XDR,
// fetch live transactions, or touch the network. It derives every "actual"
// value (warnings, state) deterministically from the already-labelled point
// fixtures in destinations.json / scores.json and the XDR files in
// transactions/.
//
//   - Warnings are keyed by a destination's `risk_pattern` (the warning
//     category) and carry the destination's `label` as severity.
//   - State is a per-participant risk tier (clean < suspicious < malicious)
//     that escalates monotonically as a participant interacts with riskier
//     destinations across the step sequence.

import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

import {
  VALID_LABELS,
  WARNING_RISK_PATTERNS,
  TIER_RANK
} from './taxonomy.mjs';

export const SCHEMA_VERSION = '1.0';
export const SUPPORTED_VERSIONS = ['1.0'];

// Stable, filesystem-safe identifiers. Applies to scenario ids, participant
// ids, and step ids so references can never be order- or path-dependent.
const STABLE_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

// ---------------------------------------------------------------------------
// Fixture loaders
// ---------------------------------------------------------------------------

export function loadDestinations(root) {
  const data = JSON.parse(readFileSync(join(root, 'destinations.json'), 'utf-8'));
  const byId = new Map();
  for (const dest of data.destinations) {
    byId.set(dest.id, dest);
  }
  return byId;
}

// Maps a transaction fixture's stable id (the .xdr filename stem) to its path.
// Listing order is never used for execution order, so this stays deterministic.
export function loadTransactionIndex(root) {
  const dir = join(root, 'transactions');
  const byId = new Map();
  for (const entry of readdirSync(dir).sort()) {
    if (!entry.endsWith('.xdr')) continue;
    byId.set(entry.slice(0, -'.xdr'.length), join(dir, entry));
  }
  return byId;
}

export function readScenarioFile(root, relPath) {
  const abs = join(root, relPath);
  let raw;
  try {
    raw = readFileSync(abs, 'utf-8');
  } catch {
    throw new Error(`scenario file not found: ${relPath}`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch (err) {
    throw new Error(`scenario "${relPath}" is not valid JSON: ${err.message}`);
  }
  return data;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ScenarioError extends Error {
  constructor(issues, title = 'Scenario validation failed:') {
    super(formatIssues(issues, title));
    this.name = 'ScenarioError';
    this.issues = issues;
    this.title = title;
  }
}

export function formatIssues(issues, title = 'Scenario validation failed:') {
  const lines = [title];
  for (const issue of issues) {
    lines.push(`  scenario "${issue.scenarioId}"`);
    if (issue.stepId) lines.push(`  step "${issue.stepId}"`);
    const value = issue.value === undefined ? '' : ` "${issue.value}"`;
    lines.push(`  ${issue.field}${value} ${issue.reason}`);
  }
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

// Validates a scenario object against schema version 1.0. Returns { issues },
// where each issue is { scenarioId, stepId, field, value, reason }. Empty
// issues means the scenario is structurally valid and all references resolve.
export function validateScenario(scenario, context) {
  const issues = [];
  const destinations = context.destinations;
  const transactions = context.transactions;
  const scenarioId =
    scenario && typeof scenario === 'object' && typeof scenario.id === 'string' && scenario.id
      ? scenario.id
      : context.scenarioId || '<unknown>';

  const add = (stepId, field, value, reason) =>
    issues.push({ scenarioId, stepId, field, value, reason });

  if (scenario === null || typeof scenario !== 'object' || Array.isArray(scenario)) {
    add(null, 'scenario', undefined, 'must be a JSON object');
    return { issues };
  }

  // --- version -------------------------------------------------------------
  if (!('schema_version' in scenario)) {
    add(null, 'schema_version', undefined, 'is required (missing)');
  } else if (typeof scenario.schema_version !== 'string' || scenario.schema_version.length === 0) {
    add(null, 'schema_version', scenario.schema_version, 'is malformed: must be a non-empty string');
  } else if (!SUPPORTED_VERSIONS.includes(scenario.schema_version)) {
    add(
      null,
      'schema_version',
      scenario.schema_version,
      `is unsupported (supported: ${SUPPORTED_VERSIONS.join(', ')})`
    );
  }

  // --- metadata ------------------------------------------------------------
  if (typeof scenario.id !== 'string' || scenario.id.length === 0) {
    add(null, 'id', scenario.id, 'is required: must be a non-empty string');
  } else if (!STABLE_ID_RE.test(scenario.id)) {
    add(null, 'id', scenario.id, `must be a stable id matching ${STABLE_ID_RE}`);
  }
  if (typeof scenario.name !== 'string' || scenario.name.trim().length === 0) {
    add(null, 'name', scenario.name, 'is required: must be a non-empty string');
  }

  // --- participants --------------------------------------------------------
  const participantIds = new Set();
  if (!Array.isArray(scenario.participants)) {
    add(null, 'participants', scenario.participants, 'must be an array');
  } else if (scenario.participants.length === 0) {
    add(null, 'participants', undefined, 'must contain at least one participant');
  } else {
    scenario.participants.forEach((p, i) => {
      const base = `participants[${i}]`;
      if (p === null || typeof p !== 'object' || Array.isArray(p)) {
        add(null, base, undefined, 'participant must be an object');
        return;
      }
      if (typeof p.id !== 'string' || p.id.length === 0) {
        add(null, `${base}.id`, p.id, 'is required: must be a non-empty string');
      } else if (!STABLE_ID_RE.test(p.id)) {
        add(null, `${base}.id`, p.id, `must be a stable id matching ${STABLE_ID_RE}`);
      } else if (participantIds.has(p.id)) {
        add(null, `${base}.id`, p.id, 'duplicate participant id');
      } else {
        participantIds.add(p.id);
      }
      checkReference(p, 'destination', destinations, null, `${base}.destination`, add);
    });
  }

  // --- steps ---------------------------------------------------------------
  const stepIds = new Set();
  const sequenceOwners = new Map(); // sequence number -> step id

  if (!Array.isArray(scenario.steps)) {
    add(null, 'steps', scenario.steps, 'must be an array');
  } else if (scenario.steps.length === 0) {
    add(null, 'steps', undefined, 'must contain at least one step');
  } else {
    scenario.steps.forEach((step, i) => {
      const stepId = typeof step?.id === 'string' && step.id ? step.id : `steps[${i}]`;

      if (step === null || typeof step !== 'object' || Array.isArray(step)) {
        add(null, `steps[${i}]`, undefined, 'step must be an object');
        return;
      }

      // step id
      if (typeof step.id !== 'string' || step.id.length === 0) {
        add(null, `steps[${i}].id`, step.id, 'is required: must be a non-empty string');
      } else if (!STABLE_ID_RE.test(step.id)) {
        add(null, `steps[${i}].id`, step.id, `must be a stable id matching ${STABLE_ID_RE}`);
      } else if (stepIds.has(step.id)) {
        add(null, `steps[${i}].id`, step.id, 'duplicate step id');
      } else {
        stepIds.add(step.id);
      }

      // sequence
      if (!('sequence' in step)) {
        add(stepId, 'sequence', undefined, 'is required (missing ordering information)');
      } else if (!Number.isInteger(step.sequence)) {
        add(stepId, 'sequence', step.sequence, 'must be an integer');
      } else if (step.sequence < 1) {
        add(stepId, 'sequence', step.sequence, 'must be a positive integer');
      } else if (sequenceOwners.has(step.sequence)) {
        add(
          stepId,
          'sequence',
          step.sequence,
          `duplicate sequence number (already used by step "${sequenceOwners.get(step.sequence)}")`
        );
      } else {
        sequenceOwners.set(step.sequence, typeof step.id === 'string' ? step.id : `steps[${i}]`);
      }

      // references
      checkReference(step, 'transaction', transactions, stepId, 'transaction', add);
      checkReference(step, 'destination', destinations, stepId, 'destination', add);

      // participants array
      if (!Array.isArray(step.participants)) {
        add(stepId, 'participants', step.participants, 'must be an array');
      } else if (step.participants.length === 0) {
        add(stepId, 'participants', undefined, 'must reference at least one participant');
      } else {
        step.participants.forEach((pid, j) => {
          if (typeof pid !== 'string' || pid.length === 0) {
            add(stepId, `participants[${j}]`, pid, 'is a malformed participant reference: must be a non-empty string');
          } else if (!participantIds.has(pid)) {
            add(stepId, `participants[${j}]`, pid, 'participant was not found');
          }
        });
      }

      // expected warnings
      if ('expected_warnings' in step && !Array.isArray(step.expected_warnings)) {
        add(stepId, 'expected_warnings', step.expected_warnings, 'must be an array');
      } else if (Array.isArray(step.expected_warnings)) {
        step.expected_warnings.forEach((w, j) => {
          const base = `expected_warnings[${j}]`;
          if (w === null || typeof w !== 'object' || Array.isArray(w)) {
            add(stepId, base, undefined, 'warning expectation must be an object');
            return;
          }
          if (typeof w.risk_pattern !== 'string' || !WARNING_RISK_PATTERNS.includes(w.risk_pattern)) {
            add(stepId, `${base}.risk_pattern`, w.risk_pattern, `must be a warning risk pattern (one of: ${WARNING_RISK_PATTERNS.join(', ')})`);
          }
          if (typeof w.expected !== 'boolean') {
            add(stepId, `${base}.expected`, w.expected, 'must be a boolean (true = warning expected, false = warning not expected)');
          }
          if ('severity' in w && (typeof w.severity !== 'string' || !VALID_LABELS.includes(w.severity))) {
            add(stepId, `${base}.severity`, w.severity, `must be one of: ${VALID_LABELS.join(', ')}`);
          }
        });
      }

      // expected state
      if ('expected_state' in step && !Array.isArray(step.expected_state)) {
        add(stepId, 'expected_state', step.expected_state, 'must be an array');
      } else if (Array.isArray(step.expected_state)) {
        step.expected_state.forEach((s, j) => {
          const base = `expected_state[${j}]`;
          if (s === null || typeof s !== 'object' || Array.isArray(s)) {
            add(stepId, base, undefined, 'state expectation must be an object');
            return;
          }
          if (typeof s.participant !== 'string' || s.participant.length === 0) {
            add(stepId, `${base}.participant`, s.participant, 'is a malformed participant reference: must be a non-empty string');
          } else if (!participantIds.has(s.participant)) {
            add(stepId, `${base}.participant`, s.participant, 'participant was not found');
          }
          if (typeof s.tier !== 'string' || !VALID_LABELS.includes(s.tier)) {
            add(stepId, `${base}.tier`, s.tier, `must be one of: ${VALID_LABELS.join(', ')}`);
          }
        });
      }

      // every step must declare at least one machine-checkable outcome
      const hasWarnings = Array.isArray(step.expected_warnings) && step.expected_warnings.length > 0;
      const hasState = Array.isArray(step.expected_state) && step.expected_state.length > 0;
      if (!hasWarnings && !hasState) {
        add(stepId, 'expected outcome', undefined, 'is missing: each step must declare expected_warnings and/or expected_state');
      }
    });
  }

  return { issues };
}

function checkReference(container, key, known, stepId, field, add) {
  if (!(key in container)) {
    add(stepId, field, undefined, 'is required (missing)');
    return false;
  }
  const value = container[key];
  if (typeof value !== 'string' || value.length === 0) {
    add(stepId, field, value, 'is a malformed reference: must be a non-empty string');
    return false;
  }
  if (!known.has(value)) {
    add(stepId, field, value, 'was not found');
    return false;
  }
  return true;
}

// ---------------------------------------------------------------------------
// Deterministic replay
// ---------------------------------------------------------------------------

// Sorts steps by ascending sequence. Duplicate sequences are rejected during
// validation, so this order is fully deterministic and independent of array
// order in the source file.
export function sortSteps(steps) {
  return [...steps].sort((a, b) => a.sequence - b.sequence);
}

// Escalate one tier toward another. Tiers are ordered clean < suspicious <
// malicious; exposure never downgrades a participant.
function escalate(current, incoming) {
  return TIER_RANK[current] >= TIER_RANK[incoming] ? current : incoming;
}

// Validates, resolves references, executes steps in deterministic order, and
// compares expected vs actual warnings and state. Throws ScenarioError on any
// validation or outcome mismatch. Returns a structured report on success.
export function replayScenario(scenario, context) {
  const { issues } = validateScenario(scenario, context);
  if (issues.length > 0) {
    throw new ScenarioError(issues);
  }

  const destinations = context.destinations;
  const scenarioId = scenario.id;

  // Initial per-participant tier comes from the participant's own destination.
  const tiers = new Map();
  for (const p of scenario.participants) {
    tiers.set(p.id, destinations.get(p.destination).label);
  }

  const report = {
    scenarioId,
    schemaVersion: scenario.schema_version,
    steps: [],
    finalState: {}
  };
  const replayIssues = [];
  const addIssue = (stepId, field, value, reason) =>
    replayIssues.push({ scenarioId, stepId, field, value, reason });

  for (const step of sortSteps(scenario.steps)) {
    const dest = destinations.get(step.destination);
    const warnings =
      dest.risk_pattern && dest.risk_pattern !== 'none'
        ? [{ risk_pattern: dest.risk_pattern, severity: dest.label }]
        : [];

    const stateChanges = [];
    for (const pid of step.participants) {
      const before = tiers.get(pid);
      const after = escalate(before, dest.label);
      tiers.set(pid, after);
      stateChanges.push({ participant: pid, before, after });
    }

    evaluateWarnings(step, warnings, addIssue);

    for (const expected of step.expected_state || []) {
      const actual = tiers.get(expected.participant);
      if (actual !== expected.tier) {
        addIssue(
          step.id,
          'expected_state',
          expected.participant,
          `expected tier "${expected.tier}" but actual tier is "${actual}"`
        );
      }
    }

    report.steps.push({
      id: step.id,
      sequence: step.sequence,
      transaction: step.transaction,
      destination: step.destination,
      warnings,
      state: stateChanges
    });
  }

  for (const [pid, tier] of tiers) {
    report.finalState[pid] = tier;
  }

  if (replayIssues.length > 0) {
    throw new ScenarioError(replayIssues, 'Scenario replay failed:');
  }

  return report;
}

function evaluateWarnings(step, actualWarnings, addIssue) {
  const expected = step.expected_warnings || [];
  const actualByCategory = new Map(actualWarnings.map((w) => [w.risk_pattern, w]));
  const expectedTrue = new Set();
  const expectedFalse = new Set();

  for (const w of expected) {
    (w.expected ? expectedTrue : expectedFalse).add(w.risk_pattern);
  }

  for (const w of expected) {
    const actual = actualByCategory.get(w.risk_pattern);
    if (w.expected && !actual) {
      addIssue(step.id, 'expected_warnings', w.risk_pattern, 'warning was expected but did not fire');
    }
    if (!w.expected && actual) {
      addIssue(step.id, 'expected_warnings', w.risk_pattern, 'warning was not expected but fired');
    }
    if (w.severity && actual && actual.severity !== w.severity) {
      addIssue(
        step.id,
        'expected_warnings',
        w.risk_pattern,
        `expected severity "${w.severity}" but actual severity is "${actual.severity}"`
      );
    }
  }

  for (const w of actualWarnings) {
    if (expectedFalse.has(w.risk_pattern)) continue; // already reported above
    if (!expectedTrue.has(w.risk_pattern)) {
      addIssue(step.id, 'expected_warnings', w.risk_pattern, 'unexpected warning fired');
    }
  }
}
