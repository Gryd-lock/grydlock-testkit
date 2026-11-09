// Synthetic personas executed on Stellar testnet by generate.mjs.
//
// Every persona is a fresh random keypair created at generation time and
// funded by Friendbot (unless `fund: false`, e.g. sponsored mules that are
// created *by* a transaction). None of them is, or is derived from, a real
// person or entity. Secret keys live in memory only and are discarded when
// the generator exits.
//
// Fields:
//   label         ground-truth tier (clean | suspicious | malicious)
//   risk_pattern  warning category (scripts/lib/taxonomy.mjs)
//   score         stub oracle score written to scores.json (0-100). This is a
//                 *simulated oracle output*, not a restatement of the label:
//                 some personas are deliberately mis-scored to model known
//                 oracle blind spots (cold-start scams scored low, noisy but
//                 clean accounts scored elevated). See docs/LABELS.md.
//   notes         one-line description (required by downstream consumers)
//   rationale     why this label: the on-chain behaviour that justifies it
//   destination   false = internal actor (victim / signer) that is never
//                 written to destinations.json
//   fund          false = do not Friendbot-fund (created by a recipe)

const clean = (name, score, notes, rationale, extra = {}) => ({
  name, label: 'clean', risk_pattern: 'none', score, notes, rationale, ...extra
});

const cleanWallets = Array.from({ length: 12 }, (_, i) => {
  const n = String(i + 1).padStart(2, '0');
  return clean(
    `clean-wallet-${n}`,
    [3, 5, 2, 4, 6, 3, 7, 2, 5, 4, 8, 3][i],
    'Ordinary testnet wallet; peer payments and TUSD use only.',
    'Funded by Friendbot and used only for ordinary activity in this run: peer XLM payments, TUSD trustline and payments, DEX trades. It never interacts with a labelled suspicious or malicious persona as a recipient of their funds.'
  );
});

export const PERSONAS = [
  // ---------------------------------------------------------------- clean
  ...cleanWallets,
  clean('clean-issuer-tusd', 2, 'Issuer of the TUSD test stablecoin.',
    'Issues TUSD and distributes it only to the TUSD distributor. Its asset is widely held by clean wallets in this run.'),
  clean('clean-distributor-tusd', 4, 'TUSD distributor and DEX market maker.',
    'Receives TUSD from the issuer, distributes it to clean wallets, posts a two-sided TUSD/XLM market and creates a TUSD claimable balance for a clean wallet.'),
  clean('clean-exchange-hot', 9, 'Exchange-style hot wallet that receives deposits tagged with a memo id.',
    'Receives deposits from clean wallets with memo-id routing tags, which is how custodial exchanges are normally paid.'),
  clean('clean-merchant-1', 3, 'Merchant receiving TUSD payments.', 'Receives TUSD payments for goods from clean wallets.'),
  clean('clean-merchant-2', 5, 'Merchant receiving path payments in TUSD.', 'Receives strict-receive path payments that settle in TUSD.'),
  clean('clean-relayer', 12, 'Fee-bump relayer that pays fees for clean users.',
    'Sponsors network fees for a clean payment via a fee-bump envelope. A fee-bump is not itself a risk signal.'),
  clean('clean-cosigner', 28,
    'Co-signer added to a clean wallet as a 2-of-2 multisig key.',
    'Added as a signer by clean-wallet-04, the same operation shape as a signer takeover, but the signing wallet raises its thresholds so it keeps control. Scored elevated on purpose: a reputation oracle that only sees "newly added signer" would plausibly flag it, so it measures false positives.',
    { risk_pattern: 'adversarial-clean', score_rationale: 'Deliberately outside the clean band (0-25): models an oracle that over-weights this attack-shaped behaviour, so the eval can measure false positives.' }),
  clean('clean-dapp-spender', 34,
    'dApp spender granted a small, short-lived Soroban token allowance.',
    'Granted a 10 TUSD allowance that expires within ~1 hour. Same operation shape as an approval drain, but bounded in amount and time. Scored elevated on purpose to measure false positives.',
    { risk_pattern: 'adversarial-clean', score_rationale: 'Deliberately outside the clean band (0-25): models an oracle that over-weights this attack-shaped behaviour, so the eval can measure false positives.' }),
  clean('clean-savings', 15,
    'Savings account that receives an account merge from its owner\'s old wallet.',
    'Receives an account merge from clean-closer, which is owned by the same synthetic user and is closing an old account. Same operation shape as a merge drain.',
    { risk_pattern: 'adversarial-clean' }),
  clean('clean-high-velocity', 41,
    'Payroll wallet that sends multi-op batch payouts to many clean wallets.',
    'Sends one multi-operation payroll batch to five clean wallets. High outgoing velocity is a common pass-through feature, so it is scored elevated to measure false positives.',
    { risk_pattern: 'adversarial-clean', score_rationale: 'Deliberately outside the clean band (0-25): models an oracle that over-weights this attack-shaped behaviour, so the eval can measure false positives.' }),
  clean('clean-new-user', 18,
    'Freshly funded clean wallet with no history.',
    'Funded by Friendbot and receives one ordinary payment. It has no history, which is the clean counterpart of the cold-start scam personas.',
    { risk_pattern: 'cold-start' }),
  clean('clean-boundary', 20,
    'Clean wallet scored exactly on the low/elevated boundary (20).',
    'Ordinary peer payments only. Its score sits on the extension\'s tier boundary (<= 20 is low) to catch off-by-one errors in tiering.'),

  // ------------------------------------------------------------ suspicious
  ...[1, 2, 3].map((i) => ({
    name: `pass-through-${i}`, label: 'suspicious', risk_pattern: 'pass-through',
    score: [58, 63, 47][i - 1],
    notes: 'Forwards incoming funds to a sweeper within the same minute.',
    rationale: 'Receives a payment from a victim and immediately forwards it to a malicious sweeper. It is a laundering hop, not the final beneficiary, so it is labelled suspicious rather than malicious.'
  })),
  { name: 'pass-through-boundary', label: 'suspicious', risk_pattern: 'pass-through', score: 51,
    notes: 'Pass-through wallet scored one point above the elevated/high boundary.',
    rationale: 'Receives a victim payment and forwards it to a sweeper. Its score of 51 sits just across the elevated/high boundary to stress tiering.' },
  ...[1, 2].map((i) => ({
    name: `scam-trustline-holder-${i}`, label: 'suspicious', risk_pattern: 'scam-trustline',
    score: [55, 52][i - 1],
    notes: 'Holds a trustline to the RUGX rug-pull asset and nothing else.',
    rationale: 'Its only activity is opening a trustline to RUGX, the rug-pull asset. That is a common profile for wallets seeded by a token promoter.'
  })),
  ...[1, 2, 3].map((i) => ({
    name: `sponsored-mule-${i}`, label: 'suspicious', risk_pattern: 'sponsored-mule', fund: false,
    score: [60, 57, 15][i - 1],
    ...(i === 3 ? { score_rationale: 'Deliberately outside the suspicious band (40-70): models an oracle that has not yet linked this mule to its sponsor (blind spot).' } : {}),
    notes: 'Account created with reserves sponsored by malicious-sponsor.',
    rationale: 'Created by malicious-sponsor through begin/endSponsoringFutureReserves, so the mule holds no XLM of its own and depends on an attacker-controlled sponsor. sponsored-mule-3 is scored low on purpose: the oracle has not yet linked it to its sponsor (blind spot).'
  })),
  ...[1, 2].map((i) => ({
    name: `memo-impersonator-${i}`, label: 'suspicious', risk_pattern: 'memo-impersonation',
    score: [66, 44][i - 1],
    notes: 'Sends dust payments with support/refund memos, then asks victims for a fee.',
    rationale: 'Sends 0.0000001 XLM dust payments whose memo impersonates an exchange support desk ("Claim refund: x.invalid") and receives a "verification fee" from a victim. This is social-engineering impersonation; the fees are small, so it is suspicious rather than malicious.'
  })),
  { name: 'claw-issuer', label: 'suspicious', risk_pattern: 'clawback-enabled', score: 53,
    notes: 'Issuer of CLAW, an asset with AUTH_REVOCABLE and AUTH_CLAWBACK_ENABLED set.',
    rationale: 'Sets AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED, issues CLAW to a holder and claws part of it back. Clawback has legitimate (regulated-asset) uses, so holders are exposed to issuer discretion but not to theft. Suspicious, not malicious.' },

  // ------------------------------------------------------------- malicious
  ...[1, 2, 3].map((i) => ({
    name: `sweeper-${i}`, label: 'malicious', risk_pattern: 'sweep',
    score: [92, 88, 72][i - 1],
    ...(i === 3 ? { score_rationale: 'Deliberately outside the malicious band (75-100): models an under-confident oracle, so the warning fires at the wrong severity (high instead of critical).' } : {}),
    notes: 'Final collection wallet for funds forwarded by pass-through hops.',
    rationale: 'Receives forwarded victim funds from pass-through wallets and path payments from victims. sweeper-3 is scored 72 (high, not critical) on purpose: the warning still fires but at the wrong severity.'
  })),
  ...[1, 2, 3].map((i) => ({
    name: `merge-drainer-${i}`, label: 'malicious', risk_pattern: 'account-merge-drain',
    score: [95, 90, 86][i - 1],
    notes: 'Receives accountMerge operations that close victim accounts.',
    rationale: 'Is the destination of accountMerge operations signed by victims, which transfer the victim\'s entire XLM balance and delete the account.'
  })),
  ...[1, 2, 3].map((i) => ({
    name: `takeover-attacker-${i}`, label: 'malicious', risk_pattern: 'signer-takeover',
    score: [97, 93, 89][i - 1],
    notes: 'Key added as a signer on victim accounts, then used to drain them.',
    rationale: 'Is added as a high-weight signer on victim accounts via setOptions. takeover-attacker-1 then signs a payment that drains its victim, proving control on-chain.'
  })),
  ...[1, 2].map((i) => ({
    name: `phishing-drainer-${i}`, label: 'malicious', risk_pattern: 'phishing-drainer',
    score: [91, 84][i - 1],
    notes: 'Sends dust "test" payments to targets, then receives a large drain.',
    rationale: 'Sends 0.0000001 XLM test payments to targets before receiving a large payment from a victim. phishing-drainer-2 also pays the fee-bump fee on the drain ("gasless" lure).'
  })),
  { name: 'rug-issuer', label: 'malicious', risk_pattern: 'rug-pull', score: 94,
    notes: 'Issuer of RUGX; holds all supply and sells it on the DEX.',
    rationale: 'Issues RUGX, keeps the whole supply in its own control and posts sell offers so victims can buy a token with no outside liquidity.' },
  { name: 'airdrop-issuer', label: 'malicious', risk_pattern: 'claimable-balance-spam', score: 87,
    notes: 'Issuer of AIRDROP; sprays unsolicited claimable balances at targets.',
    rationale: 'Creates unsolicited claimable balances of its own AIRDROP asset for targets so they open a trustline and engage. Airdrop spam is a lure for follow-on phishing.' },
  ...[1, 2].map((i) => ({
    name: `approval-drainer-${i}`, label: 'malicious', risk_pattern: 'soroban-approval-drain',
    score: [96, 90][i - 1],
    notes: 'Unknown Soroban spender that receives large allowances, then calls transfer_from.',
    rationale: 'Receives a near-unlimited Soroban token approve() from a victim, then calls transfer_from to move the victim\'s balance to itself, executed on-chain.'
  })),
  ...[1, 2, 3].map((i) => ({
    name: `cold-start-scam-${i}`, label: 'malicious', risk_pattern: 'cold-start',
    score: [8, 12, 5][i - 1],
    score_rationale: 'Deliberately outside the malicious band (75-100): a reputation oracle has no history for a freshly funded wallet (cold-start blind spot). These fixtures measure that gap.',
    notes: 'Freshly funded scam collection wallet with no history.',
    rationale: 'Designated by the scenario as a scam collection wallet but funded moments before use, with no history. Its label is ground truth by construction. Its stub score is deliberately low to model the oracle\'s cold-start blind spot, so these fixtures are expected misses that measure that gap.'
  })),
  { name: 'malicious-sponsor', label: 'malicious', risk_pattern: 'sponsored-mule', score: 82,
    notes: 'Sponsors reserves for mule accounts it controls.',
    rationale: 'Creates and sponsors the reserves of three mule accounts, so they hold no XLM of their own. This builds mule infrastructure.' },

  // ------------------------------------------- internal actors (not destinations)
  ...[
    'victim-1', 'victim-2', 'victim-3', 'victim-4', 'victim-5', 'victim-6', 'victim-7', 'victim-8',
    'victim-merge-1', 'victim-merge-2', 'victim-merge-3', 'victim-takeover-1', 'victim-takeover-2',
    'clean-closer'
  ].map((name) => ({ name, destination: false }))
];

// Issued assets: destinations of type "asset" (CODE:ISSUER) and, when
// `sac: true`, a Stellar Asset Contract destination of type "contract".
export const ASSETS = [
  { code: 'TUSD', issuer: 'clean-issuer-tusd', label: 'clean', risk_pattern: 'none', score: 2,
    sac: { label: 'clean', risk_pattern: 'none', score: 3 },
    notes: 'Synthetic test stablecoin held by many clean wallets.',
    rationale: 'Issued by a clean issuer, distributed widely and traded on a two-sided market.' },
  { code: 'CLAW', issuer: 'claw-issuer', label: 'suspicious', risk_pattern: 'clawback-enabled', score: 56,
    flags: 'clawback',
    notes: 'Asset with AUTH_CLAWBACK_ENABLED; the issuer can reclaim holder balances.',
    rationale: 'Issued with AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED, and a clawback is executed on-chain against a holder. A user trusting it should be told the issuer can take the balance back.' },
  { code: 'RUGX', issuer: 'rug-issuer', label: 'malicious', risk_pattern: 'rug-pull', score: 96,
    sac: { label: 'malicious', risk_pattern: 'rug-pull', score: 93 },
    notes: 'Rug-pull token: all supply with the issuer, sold to victims on the DEX.',
    rationale: 'All supply is held and sold by rug-issuer, and there is no independent liquidity. Its SAC wrapper carries the same label.' },
  { code: 'AIRDROP', issuer: 'airdrop-issuer', label: 'malicious', risk_pattern: 'claimable-balance-spam', score: 85,
    notes: 'Unsolicited airdrop token delivered via claimable balances.',
    rationale: 'It exists only to be sprayed at targets as unsolicited claimable balances (a lure).' }
];
