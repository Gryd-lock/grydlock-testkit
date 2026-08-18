// Validates every scenario bundle in scenarios/ against the versioned schema:
// schema version, metadata, participant/destination/transaction references,
// and deterministic step ordering. Exits non-zero on the first set of errors.
//
// Usage: node scripts/validate-scenarios.mjs

import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  loadDestinations,
  loadTransactionIndex,
  readScenarioFile,
  validateScenario,
  formatIssues
} from './lib/scenario.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const scenariosDir = join(root, 'scenarios');

const context = {
  destinations: loadDestinations(root),
  transactions: loadTransactionIndex(root)
};

const files = readdirSync(scenariosDir)
  .filter((name) => name.endsWith('.json'))
  .sort();

if (files.length === 0) {
  console.error('Scenario validation failed: no scenario files found in scenarios/.');
  process.exit(1);
}

let allIssues = [];
for (const file of files) {
  let scenario;
  try {
    scenario = readScenarioFile(root, join('scenarios', file));
  } catch (err) {
    allIssues.push({
      scenarioId: file,
      stepId: null,
      field: 'scenario',
      value: undefined,
      reason: err.message
    });
    continue;
  }
  const { issues } = validateScenario(scenario, {
    ...context,
    scenarioId: file
  });
  allIssues = allIssues.concat(issues);
}

if (allIssues.length > 0) {
  console.error(formatIssues(allIssues));
  process.exit(1);
}

console.log(`Scenario validation passed: ${files.length} scenario(s).`);
