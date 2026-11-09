export type Label = 'clean' | 'suspicious' | 'malicious';
export type ProvenanceKind = 'testnet' | 'offline-synthetic';

export interface Destination {
  id: string;
  type: 'account' | 'asset' | 'contract';
  label: Label;
  risk_pattern: string;
  notes: string;
  rationale: string;
  persona?: string;
  fixture_status: 'synthetic-only';
  address?: string;
  asset_code?: string;
  asset_issuer?: string;
  contract_kind?: string;
  wraps_asset?: string;
  provenance: {
    kind: ProvenanceKind;
    funded?: boolean;
    funding_tx?: string | null;
    evidence_txs?: string[];
    explorer?: string;
  };
}

export interface OperationSummary {
  index: number;
  type: string;
  [field: string]: unknown;
}

export interface TransactionFixture {
  id: string;
  file: string;
  envelopeType: 'envelopeTypeTx' | 'envelopeTypeTxFeeBump';
  signed: boolean;
  stellarHashTestnet: string;
  label: Label;
  risk_pattern: string;
  rationale: string;
  description: string;
  source: string;
  feeBumpSource?: string;
  counterparties: string[];
  operations: OperationSummary[];
  provenance: {
    kind: ProvenanceKind;
    submitted: boolean;
    txHash?: string;
    ledger?: number;
    closedAt?: string;
    explorer?: string;
  };
}

export const datasetVersion: string;
export const NETWORK_PASSPHRASE: 'Test SDF Network ; September 2015';
export function loadDestinations(): { destinations: Destination[] };
export function loadScores(): Record<string, number>;
export function loadTransactions(): { network: 'TESTNET'; passphrase: string; fixtures: TransactionFixture[] };
export function readTransactionXdr(id: string): string;
export function loadScenario(name: string): unknown;
export function loadTestnetRun(): unknown;
export const paths: Readonly<{
  destinations: string;
  scores: string;
  transactionsDir: string;
  transactionIndex: string;
  scenariosDir: string;
}>;
