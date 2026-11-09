#!/usr/bin/env node
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { evaluateRepo, formatReport } from './evaluate/pipeline.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const json = process.argv.includes('--json');

const report = evaluateRepo(root);

if (json) {
  console.log(JSON.stringify(report, null, 2));
} else {
  console.log(formatReport(report));
}

process.exit(report.ok ? 0 : 1);
