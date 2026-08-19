// Deterministic offline replay of a single scenario bundle.
//
// Loads the scenario, validates the schema, resolves all references, checks
// step ordering, executes steps in sequence order, applies the synthetic state
// transitions, evaluates warning outcomes, and compares expected vs actual.
// Exits non-zero on any validation or outcome mismatch.
//
// Usage:
//   node scripts/replay-scenario.mjs <scenario.json>      # relative to repo root
//   node scripts/replay-scenario.mjs scenarios/phishing-drain.json

import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadDestinations,
  loadTransactionIndex,
  readScenarioFile,
  replayScenario,
  ScenarioError
} from './lib/scenario.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));

const arg = process.argv[2];
if (!arg) {
  console.error('Usage: node scripts/replay-scenario.mjs <path-to-scenario.json>');
  process.exit(2);
}

// Resolve the scenario path relative to the repository root (where `root`
// already carries a trailing slash).
const absPath = resolve(root, arg.replace(/^\.\//, ''));
const relToRoot = absPath.startsWith(root) ? absPath.slice(root.length) : absPath;

let scenario;
try {
  scenario = readScenarioFile(root, relToRoot);
} catch (err) {
  console.error(`Scenario replay failed:\n  ${err.message}`);
  process.exit(1);
}

const context = {
  destinations: loadDestinations(root),
  transactions: loadTransactionIndex(root),
  scenarioId: relToRoot
};

try {
  const report = replayScenario(scenario, context);
  console.log(`Scenario replay passed: "${report.scenarioId}" (schema ${report.schemaVersion})`);
  console.log('');
  for (const step of report.steps) {
    const warnings = step.warnings.length
      ? step.warnings.map((w) => `${w.risk_pattern}(${w.severity})`).join(', ')
      : 'none';
    const state = step.state.map((s) => `${s.participant}: ${s.before} -> ${s.after}`).join(', ');
    console.log(`  step ${step.sequence} "${step.id}"`);
    console.log(`    transaction: ${step.transaction}`);
    console.log(`    destination: ${step.destination}`);
    console.log(`    warnings: ${warnings}`);
    console.log(`    state: ${state}`);
  }
  console.log('');
  console.log('  final state:', JSON.stringify(report.finalState));
} catch (err) {
  if (err instanceof ScenarioError) {
    console.error(err.message);
  } else {
    console.error(`Scenario replay failed:\n  ${err.message}`);
  }
  process.exit(1);
}
