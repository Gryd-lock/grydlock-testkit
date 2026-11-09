// grydlock-testkit — zero-dependency loaders for the labelled fixture set.
//
//   import { loadDestinations, loadScores, loadTransactions, readTransactionXdr } from 'grydlock-testkit';
//
// Raw files are also exported for bundlers and non-Node consumers:
//   grydlock-testkit/destinations.json, grydlock-testkit/scores.json,
//   grydlock-testkit/transactions/index.json, grydlock-testkit/transactions/<id>.xdr,
//   grydlock-testkit/scenarios/<name>.json, grydlock-testkit/dataset/testnet-run.json

import { readFileSync } from 'node:fs';

const file = (rel) => new URL(rel, import.meta.url);
const json = (rel) => JSON.parse(readFileSync(file(rel), 'utf-8'));

export const datasetVersion = json('./package.json').version;

/** Testnet network passphrase every transaction fixture must be decoded with. */
export const NETWORK_PASSPHRASE = 'Test SDF Network ; September 2015';

/** @returns {{ destinations: object[] }} the parsed destinations.json */
export function loadDestinations() {
  return json('./destinations.json');
}

/** @returns {Record<string, number>} destination id -> stub score (0-100) */
export function loadScores() {
  return json('./scores.json');
}

/** @returns {{ network: string, passphrase: string, fixtures: object[] }} transactions/index.json */
export function loadTransactions() {
  return json('./transactions/index.json');
}

/** Base64 XDR envelope for a transaction fixture id, e.g. "mal_account_merge_drain". */
export function readTransactionXdr(id) {
  if (!/^[a-z0-9_]+$/.test(id)) throw new Error(`invalid transaction fixture id "${id}"`);
  return readFileSync(file(`./transactions/${id}.xdr`), 'utf-8').trim();
}

/** Parsed scenario bundle, e.g. loadScenario("phishing-drain"). */
export function loadScenario(name) {
  if (!/^[a-z0-9-]+$/.test(name)) throw new Error(`invalid scenario name "${name}"`);
  return json(`./scenarios/${name}.json`);
}

/** Audit trail of the testnet run that produced the testnet fixtures. */
export function loadTestnetRun() {
  return json('./dataset/testnet-run.json');
}

/** Absolute filesystem paths of the raw data files. */
export const paths = Object.freeze({
  destinations: file('./destinations.json').pathname,
  scores: file('./scores.json').pathname,
  transactionsDir: file('./transactions/').pathname,
  transactionIndex: file('./transactions/index.json').pathname,
  scenariosDir: file('./scenarios/').pathname
});
