import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const destinations = JSON.parse(readFileSync(`${root}/destinations.json`, 'utf-8')).destinations;
const scores = JSON.parse(readFileSync(`${root}/scores.json`, 'utf-8'));

const VALID_LABELS = new Set(['clean', 'suspicious', 'malicious']);
const errors = [];

for (const d of destinations) {
  if (!VALID_LABELS.has(d.label)) {
    errors.push(`${d.id}: invalid label "${d.label}"`);
  }
  if (!(d.id in scores)) {
    errors.push(`${d.id}: missing entry in scores.json`);
  }
}

for (const [id, score] of Object.entries(scores)) {
  if (typeof score !== 'number' || score < 0 || score > 100) {
    errors.push(`${id}: score ${score} out of range 0-100`);
  }
  if (!destinations.some((d) => d.id === id)) {
    errors.push(`${id}: present in scores.json but not in destinations.json`);
  }
}

if (errors.length > 0) {
  console.error(`Fixture validation failed:\n${errors.map((e) => `  - ${e}`).join('\n')}`);
  process.exit(1);
}

console.log(
  `Fixture validation passed: ${destinations.length} destinations, ${Object.keys(scores).length} scores.`,
);
