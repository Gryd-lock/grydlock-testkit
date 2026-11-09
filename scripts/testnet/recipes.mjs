// Ordered on-chain script executed by generate.mjs.
//
// Each recipe is one of:
//   kind: 'setup'     builds state (assets, trustlines, offers, history). Its
//                     tx hashes go to dataset/testnet-run.json as evidence.
//   kind: 'fixture'   a labelled transaction. Its *unsigned* envelope is
//                     written to transactions/<id>.xdr. The envelope hash
//                     equals the on-chain tx hash, so every fixture can be
//                     looked up on stellar.expert/explorer/testnet.
//   kind: 'evidence'  follow-up behaviour that proves a label (e.g. the
//                     attacker actually draining after a signer takeover).
//
// Fixture labels describe the harm of *signing this transaction* for the
// signing account, judged by construction. See docs/LABELS.md for the rubric.
//
// To add a fixture: append a recipe with kind 'fixture', a unique id
// (becomes transactions/<id>.xdr), label, risk_pattern, description and
// rationale, then run `npm run generate:testnet`.

import { Operation, Asset, Memo, Address, nativeToScVal } from '@stellar/stellar-sdk';

const I128_MAX = (1n << 127n) - 1n;
const addr = (g) => new Address(g).toScVal();
const i128 = (n) => nativeToScVal(BigInt(n), { type: 'i128' });
const u32 = (n) => nativeToScVal(n, { type: 'u32' });
const stroops = (xlmOrToken) => BigInt(Math.round(Number(xlmOrToken) * 1e7));

const pay = (destination, amount, asset = Asset.native()) =>
  Operation.payment({ destination, asset, amount: String(amount) });

const setup = (id, description, run) => ({ kind: 'setup', id, description, run });
const evidence = (id, description, run) => ({ kind: 'evidence', id, description, run });
const fixture = (id, label, risk_pattern, description, rationale, run) => ({
  kind: 'fixture', id, label, risk_pattern, description, rationale, run
});

export const RECIPES = [
  // =========================================================== setup: assets
  setup('tusd-distributor-trust', 'TUSD distributor trusts TUSD', (c) =>
    c.classic('clean-distributor-tusd', [Operation.changeTrust({ asset: c.asset('TUSD') })])),
  setup('tusd-issue', 'Issuer mints 1,000,000 TUSD to the distributor', (c) =>
    c.classic('clean-issuer-tusd', [pay(c.pub('clean-distributor-tusd'), 1_000_000, c.asset('TUSD'))])),
  setup('tusd-trustlines', 'TUSD trustlines for holders used by later fixtures', (c) =>
    c.parallel(
      [
        'clean-wallet-01', 'clean-wallet-02', 'clean-wallet-03', 'clean-wallet-07', 'clean-wallet-12',
        'clean-merchant-1', 'clean-merchant-2', 'sweeper-1', 'sweeper-2', 'pass-through-2',
        'victim-5', 'approval-drainer-1'
      ].map((who) => () => c.classic(who, [Operation.changeTrust({ asset: c.asset('TUSD') })])))),
  setup('tusd-distribute', 'Distributor pays TUSD to clean wallets and victim-5', (c) =>
    c.classic('clean-distributor-tusd', [
      pay(c.pub('clean-wallet-01'), 1000, c.asset('TUSD')),
      pay(c.pub('clean-wallet-03'), 1000, c.asset('TUSD')),
      pay(c.pub('victim-5'), 5000, c.asset('TUSD'))
    ])),
  setup('tusd-market', 'Distributor posts a TUSD/XLM sell offer (0.5 XLM per TUSD)', (c) =>
    c.classic('clean-distributor-tusd', [
      Operation.manageSellOffer({ selling: c.asset('TUSD'), buying: Asset.native(), amount: '100000', price: '0.5' })
    ])),
  setup('tusd-claimable', 'Distributor creates a 250 TUSD claimable balance for clean-wallet-12', async (c) => {
    const rec = await c.classic('clean-distributor-tusd', [
      Operation.createClaimableBalance({
        asset: c.asset('TUSD'), amount: '250',
        claimants: [new c.sdk.Claimant(c.pub('clean-wallet-12'), c.sdk.Claimant.predicateUnconditional())]
      })
    ]);
    c.state.tusdBalanceId = rec.tx.getClaimableBalanceId(0);
    return rec;
  }),
  setup('tusd-sac-deploy', 'Deploy the Stellar Asset Contract for TUSD', (c) => c.deploySac('clean-issuer-tusd', 'TUSD')),
  setup('claw-flags', 'CLAW issuer sets AUTH_REVOCABLE | AUTH_CLAWBACK_ENABLED', (c) =>
    c.classic('claw-issuer', [Operation.setOptions({ setFlags: 2 | 8 })])),
  setup('rugx-holders', 'Two scam-trustline holders trust RUGX', (c) =>
    c.parallel(['scam-trustline-holder-1', 'scam-trustline-holder-2'].map((who) => () =>
      c.classic(who, [Operation.changeTrust({ asset: c.asset('RUGX') })])))),
  setup('rugx-market', 'Rug issuer posts a RUGX sell offer (0.1 XLM per RUGX)', (c) =>
    c.classic('rug-issuer', [
      Operation.manageSellOffer({ selling: c.asset('RUGX'), buying: Asset.native(), amount: '1000000', price: '0.1' })
    ])),
  setup('rugx-sac-deploy', 'Deploy the Stellar Asset Contract for RUGX', (c) => c.deploySac('rug-issuer', 'RUGX')),
  setup('airdrop-spray', 'Airdrop issuer sprays unsolicited AIRDROP claimable balances', async (c) => {
    const rec = await c.classic('airdrop-issuer', ['victim-2', 'victim-6'].map((v) =>
      Operation.createClaimableBalance({
        asset: c.asset('AIRDROP'), amount: '1000',
        claimants: [new c.sdk.Claimant(c.pub(v), c.sdk.Claimant.predicateUnconditional())]
      })));
    c.state.airdropBalanceId = rec.tx.getClaimableBalanceId(0);
    return rec;
  }),
  setup('clean-history', 'Ordinary peer payments between clean wallets', (c) =>
    c.parallel([
      () => c.classic('clean-wallet-04', [pay(c.pub('clean-boundary'), 30)]),
      () => c.classic('clean-wallet-08', [pay(c.pub('clean-wallet-09'), 12)]),
      () => c.classic('clean-wallet-10', [pay(c.pub('clean-wallet-11'), 8)])
    ])),
  setup('phishing-dust', 'Phishing drainers send dust "test" payments to targets', (c) =>
    c.parallel([
      () => c.classic('phishing-drainer-1', [pay(c.pub('victim-4'), '0.0000001')], { memo: Memo.text('test') }),
      () => c.classic('phishing-drainer-2', [pay(c.pub('victim-8'), '0.0000001')], { memo: Memo.text('test') })
    ])),
  setup('memo-lures', 'Memo impersonators send dust payments with refund-lure memos', (c) =>
    c.parallel([
      () => c.classic('memo-impersonator-1', [pay(c.pub('victim-3'), '0.0000001')], { memo: Memo.text('Claim refund: x.invalid') }),
      () => c.classic('memo-impersonator-2', [pay(c.pub('victim-1'), '0.0000001')], { memo: Memo.text('Support ticket: x.invalid') })
    ])),
  ...[2, 3].map((n) => setup(`sponsor-mule-${n}`, `malicious-sponsor creates sponsored-mule-${n}`, (c) =>
    c.classic('malicious-sponsor', [
      Operation.beginSponsoringFutureReserves({ sponsoredId: c.pub(`sponsored-mule-${n}`) }),
      Operation.createAccount({ destination: c.pub(`sponsored-mule-${n}`), startingBalance: '0' }),
      Operation.endSponsoringFutureReserves({ source: c.pub(`sponsored-mule-${n}`) })
    ], { signers: ['malicious-sponsor', `sponsored-mule-${n}`] }))),

  // ========================================================= fixtures: clean
  fixture('clean_payment_xlm', 'clean', 'none',
    'Plain XLM payment between two clean wallets.',
    'Both parties are ordinary clean wallets; nothing about the operation is risky.',
    (c) => c.classic('clean-wallet-01', [pay(c.pub('clean-wallet-02'), 120)])),
  fixture('clean_payment_tusd_merchant', 'clean', 'none',
    'TUSD payment to a merchant.',
    'Pays a clean merchant in a clean, widely held asset.',
    (c) => c.classic('clean-wallet-03', [pay(c.pub('clean-merchant-1'), '45.5', c.asset('TUSD'))])),
  fixture('clean_payment_exchange_memo_id', 'clean', 'none',
    'Exchange deposit with a memo-id routing tag.',
    'Depositing to an exchange hot wallet with a memo id is the normal custodial deposit flow.',
    (c) => c.classic('clean-wallet-05', [pay(c.pub('clean-exchange-hot'), 300)], { memo: Memo.id('884213') })),
  fixture('clean_path_strict_send', 'clean', 'none',
    'Path payment strict-send XLM -> TUSD to a clean wallet, filled against the clean TUSD market.',
    'The recipient and the asset are clean, and the path crosses only the clean distributor\'s offer.',
    (c) => c.classic('clean-wallet-06', [Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(), sendAmount: '50', destination: c.pub('clean-wallet-07'),
      destAsset: c.asset('TUSD'), destMin: '1', path: []
    })])),
  fixture('clean_path_strict_receive', 'clean', 'none',
    'Path payment strict-receive XLM -> 20 TUSD to a merchant.',
    'The recipient and the asset are clean.',
    (c) => c.classic('clean-wallet-08', [Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(), sendMax: '100', destination: c.pub('clean-merchant-2'),
      destAsset: c.asset('TUSD'), destAmount: '20', path: []
    })])),
  fixture('clean_fee_bump_payment', 'clean', 'none',
    'Fee-bump envelope: clean-relayer pays the fee for a clean XLM payment.',
    'A fee bump only changes who pays the fee. The fee source and recipient are both clean.',
    (c) => c.feeBump('clean-relayer', 'clean-wallet-09', [pay(c.pub('clean-wallet-10'), 75)])),
  fixture('clean_change_trust_tusd', 'clean', 'none',
    'changeTrust to the clean TUSD asset.',
    'TUSD is a clean, widely held asset.',
    (c) => c.classic('clean-wallet-11', [Operation.changeTrust({ asset: c.asset('TUSD') })])),
  fixture('clean_claim_claimable_tusd', 'clean', 'none',
    'Claim a TUSD claimable balance created by the clean distributor.',
    'The claimant already trusts TUSD, and the balance comes from a clean distributor.',
    (c) => c.classic('clean-wallet-12', [Operation.claimClaimableBalance({ balanceId: c.state.tusdBalanceId })])),
  fixture('clean_soroban_sac_transfer', 'clean', 'none',
    'Soroban invokeHostFunction: TUSD SAC transfer(from, to, 10 TUSD) between clean wallets.',
    'A token transfer via the clean TUSD contract to a clean wallet.',
    (c) => c.invoke('clean-wallet-01', c.sac('TUSD'), 'transfer',
      [addr(c.pub('clean-wallet-01')), addr(c.pub('clean-wallet-02')), i128(stroops(10))])),
  fixture('clean_soroban_approve_bounded', 'clean', 'adversarial-clean',
    'Soroban approve(): 10 TUSD allowance to a known dApp spender, expiring in ~720 ledgers (~1h).',
    'The allowance is small and short-lived, and the spender is a clean dApp. It has the same shape as an approval drain, which makes it a false-positive probe.',
    async (c) => c.invoke('clean-wallet-03', c.sac('TUSD'), 'approve',
      [addr(c.pub('clean-wallet-03')), addr(c.pub('clean-dapp-spender')), i128(stroops(10)), u32((await c.latestLedger()) + 720)])),
  fixture('clean_set_options_cosigner', 'clean', 'adversarial-clean',
    'setOptions: add clean-cosigner (weight 1) and raise med/high thresholds to 2, making a 2-of-2 multisig.',
    'The owner keeps its master key (weight 1) and needs both keys for payments. That adds security rather than handing over control. Same operation type as a signer takeover, so it is a false-positive probe.',
    (c) => c.classic('clean-wallet-04', [Operation.setOptions({
      signer: { ed25519PublicKey: c.pub('clean-cosigner'), weight: 1 }, medThreshold: 2, highThreshold: 2
    })])),
  fixture('clean_account_merge_own_wallet', 'clean', 'adversarial-clean',
    'accountMerge: clean-closer closes its account into the same user\'s clean-savings.',
    'The merge destination belongs to the same synthetic user. Same operation as a merge drain, so it is a false-positive probe.',
    (c) => c.classic('clean-closer', [Operation.accountMerge({ destination: c.pub('clean-savings') })])),
  fixture('clean_multi_op_payroll', 'clean', 'adversarial-clean',
    'Five-operation payroll batch paying 40 XLM to five clean wallets.',
    'Every recipient is clean. The high fan-out resembles a pass-through distribution, which makes it a false-positive probe.',
    (c) => c.classic('clean-high-velocity',
      ['01', '02', '03', '04', '05'].map((n) => pay(c.pub(`clean-wallet-${n}`), 40)))),
  fixture('clean_dex_sell_offer', 'clean', 'none',
    'manageSellOffer selling 20 XLM for TUSD at 1.9 TUSD/XLM, crossing the clean market.',
    'An ordinary DEX trade into a clean asset.',
    (c) => c.classic('clean-wallet-02', [Operation.manageSellOffer({
      selling: Asset.native(), buying: c.asset('TUSD'), amount: '20', price: '1.9'
    })])),
  fixture('clean_payment_new_user', 'clean', 'cold-start',
    'XLM payment to a freshly funded clean wallet with no history.',
    'The recipient is clean but has no history (the clean counterpart of a cold-start scam).',
    (c) => c.classic('clean-wallet-05', [pay(c.pub('clean-new-user'), 25)])),
  fixture('clean_payment_boundary_score', 'clean', 'none',
    'XLM payment to clean-boundary, whose stub score is exactly 20 (low/elevated boundary).',
    'The recipient is clean. The fixture exists to catch tiering off-by-one errors.',
    (c) => c.classic('clean-wallet-06', [pay(c.pub('clean-boundary'), 15)])),

  // ==================================================== fixtures: suspicious
  fixture('susp_payment_pass_through', 'suspicious', 'pass-through',
    'XLM payment to pass-through-1, which forwards it to sweeper-1 within the minute (see evidence).',
    'The recipient is a laundering hop rather than the final beneficiary.',
    (c) => c.classic('victim-1', [pay(c.pub('pass-through-1'), 200)])),
  evidence('pass-through-1-forward', 'pass-through-1 forwards 195 XLM to sweeper-1', (c) =>
    c.classic('pass-through-1', [pay(c.pub('sweeper-1'), 195)])),
  fixture('susp_path_payment_pass_through', 'suspicious', 'pass-through',
    'Path payment strict-send XLM -> TUSD to pass-through-2, which forwards TUSD to sweeper-2.',
    'The recipient is a laundering hop. The path itself crosses only the clean market.',
    (c) => c.classic('victim-3', [Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(), sendAmount: '30', destination: c.pub('pass-through-2'),
      destAsset: c.asset('TUSD'), destMin: '10', path: []
    })])),
  evidence('pass-through-2-forward', 'pass-through-2 forwards 10 TUSD to sweeper-2', (c) =>
    c.classic('pass-through-2', [pay(c.pub('sweeper-2'), 10, c.asset('TUSD'))])),
  evidence('pass-through-3-hop', 'victim-6 pays pass-through-3, which forwards to sweeper-3', async (c) => {
    await c.classic('victim-6', [pay(c.pub('pass-through-3'), 100)]);
    return c.classic('pass-through-3', [pay(c.pub('sweeper-3'), 99)]);
  }),
  fixture('susp_payment_boundary_pass_through', 'suspicious', 'pass-through',
    'XLM payment to pass-through-boundary (stub score 51: elevated/high boundary).',
    'The recipient is a laundering hop. The fixture exists to catch tiering off-by-one errors.',
    (c) => c.classic('victim-8', [pay(c.pub('pass-through-boundary'), 50)])),
  evidence('pass-through-boundary-forward', 'pass-through-boundary forwards 49 XLM to sweeper-3', (c) =>
    c.classic('pass-through-boundary', [pay(c.pub('sweeper-3'), 49)])),
  fixture('susp_payment_memo_impersonation', 'suspicious', 'memo-impersonation',
    'Pays 25 XLM "KYC verification fee" to memo-impersonator-1 after receiving its refund-lure memo.',
    'The recipient impersonates a support desk via memos. The loss is a small fee, so suspicious rather than malicious.',
    (c) => c.classic('victim-3', [pay(c.pub('memo-impersonator-1'), 25)], { memo: Memo.text('KYC verification fee') })),
  fixture('susp_change_trust_clawback_asset', 'suspicious', 'clawback-enabled',
    'changeTrust to CLAW, an asset whose issuer has AUTH_CLAWBACK_ENABLED.',
    'The issuer can claw back the balance (executed on-chain in the follow-up evidence). The user should be told, but this is not theft.',
    (c) => c.classic('victim-2', [Operation.changeTrust({ asset: c.asset('CLAW') })])),
  evidence('claw-issue-and-clawback', 'claw-issuer pays victim-2 100 CLAW, then claws back 40', async (c) => {
    await c.classic('claw-issuer', [pay(c.pub('victim-2'), 100, c.asset('CLAW'))]);
    return c.classic('claw-issuer', [Operation.clawback({ asset: c.asset('CLAW'), from: c.pub('victim-2'), amount: '40' })]);
  }),
  fixture('susp_sponsored_mule_creation', 'suspicious', 'sponsored-mule',
    'begin/endSponsoringFutureReserves + createAccount: malicious-sponsor creates sponsored-mule-1 with sponsored reserves.',
    'The new account depends on an attacker-controlled sponsor (mule infrastructure). Signed by both parties.',
    (c) => c.classic('malicious-sponsor', [
      Operation.beginSponsoringFutureReserves({ sponsoredId: c.pub('sponsored-mule-1') }),
      Operation.createAccount({ destination: c.pub('sponsored-mule-1'), startingBalance: '0' }),
      Operation.endSponsoringFutureReserves({ source: c.pub('sponsored-mule-1') })
    ], { signers: ['malicious-sponsor', 'sponsored-mule-1'] })),
  fixture('susp_change_trust_scam_asset', 'suspicious', 'scam-trustline',
    'changeTrust to RUGX, the rug-pull token.',
    'A trustline alone moves no funds, so this is suspicious rather than malicious. It is the first step of buying a rug-pull token (see malicious_path_buy_rug_token).',
    (c) => c.classic('victim-3', [Operation.changeTrust({ asset: c.asset('RUGX') })])),
  fixture('susp_claim_airdrop_spam', 'suspicious', 'claimable-balance-spam',
    'Multi-op: changeTrust AIRDROP + claimClaimableBalance of an unsolicited airdrop.',
    'Claiming spam engages the user with the attacker\'s asset (a phishing lure), but no funds leave the account.',
    (c) => c.classic('victim-2', [
      Operation.changeTrust({ asset: c.asset('AIRDROP') }),
      Operation.claimClaimableBalance({ balanceId: c.state.airdropBalanceId })
    ])),

  // ===================================================== fixtures: malicious
  fixture('mal_path_payment_sweeper', 'malicious', 'sweep',
    'Path payment strict-send XLM -> TUSD delivered to sweeper-1.',
    'The funds land with a final collection wallet for stolen funds.',
    (c) => c.classic('victim-1', [Operation.pathPaymentStrictSend({
      sendAsset: Asset.native(), sendAmount: '400', destination: c.pub('sweeper-1'),
      destAsset: c.asset('TUSD'), destMin: '100', path: []
    })])),
  fixture('mal_fee_bump_gasless_drain', 'malicious', 'phishing-drainer',
    'Fee-bump: phishing-drainer-2 pays the fee for a 5,000 XLM payment from victim-4 to phishing-drainer-1 ("gasless" lure).',
    'The inner payment drains the victim to a phishing drainer, and the outer fee source is also attacker-controlled. A decoder must look inside the fee bump.',
    (c) => c.feeBump('phishing-drainer-2', 'victim-4', [pay(c.pub('phishing-drainer-1'), 5000)])),
  fixture('mal_set_options_signer_takeover', 'malicious', 'signer-takeover',
    'setOptions: add takeover-attacker-1 as signer (weight 255) and set master weight to 0.',
    'The victim permanently hands sole control to the attacker. The follow-up evidence shows the attacker draining the account.',
    (c) => c.classic('victim-takeover-1', [Operation.setOptions({
      signer: { ed25519PublicKey: c.pub('takeover-attacker-1'), weight: 255 }, masterWeight: 0
    })])),
  evidence('takeover-drain', 'takeover-attacker-1 signs a 9,000 XLM drain from victim-takeover-1', (c) =>
    c.classic('victim-takeover-1', [pay(c.pub('takeover-attacker-1'), 9000)], { signers: ['takeover-attacker-1'] })),
  fixture('mal_set_options_threshold_takeover', 'malicious', 'signer-takeover',
    'setOptions: add takeover-attacker-2 (weight 1) and set all thresholds to 1.',
    'The attacker key alone can now authorise any operation, including payments and merges.',
    (c) => c.classic('victim-takeover-2', [Operation.setOptions({
      signer: { ed25519PublicKey: c.pub('takeover-attacker-2'), weight: 1 },
      lowThreshold: 1, medThreshold: 1, highThreshold: 1
    })])),
  fixture('mal_account_merge_drain', 'malicious', 'account-merge-drain',
    'accountMerge: victim-merge-1 merges its whole account into merge-drainer-1.',
    'Transfers the entire balance to an attacker and deletes the victim account. This cannot be undone.',
    (c) => c.classic('victim-merge-1', [Operation.accountMerge({ destination: c.pub('merge-drainer-1') })])),
  evidence('merge-drainer-3-merge', 'victim-merge-3 merges into merge-drainer-3', (c) =>
    c.classic('victim-merge-3', [Operation.accountMerge({ destination: c.pub('merge-drainer-3') })])),
  fixture('mal_soroban_transfer_to_sweeper', 'malicious', 'sweep',
    'Soroban TUSD SAC transfer(victim-5, sweeper-2, 100 TUSD).',
    'A token transfer to a malicious collection wallet via a clean contract. The contract is clean; the recipient argument is not.',
    (c) => c.invoke('victim-5', c.sac('TUSD'), 'transfer',
      [addr(c.pub('victim-5')), addr(c.pub('sweeper-2')), i128(stroops(100))])),
  fixture('mal_soroban_approve_unlimited', 'malicious', 'soroban-approval-drain',
    'Soroban TUSD SAC approve(victim-5, approval-drainer-1, i128::MAX, +1,000,000 ledgers).',
    'An unlimited, months-long allowance to an unknown spender. The spender then calls transfer_from and drains the balance (evidence).',
    async (c) => c.invoke('victim-5', c.sac('TUSD'), 'approve',
      [addr(c.pub('victim-5')), addr(c.pub('approval-drainer-1')), i128(I128_MAX), u32((await c.latestLedger()) + 1_000_000)])),
  evidence('approval-drain-tusd', 'approval-drainer-1 calls transfer_from to take 4,900 TUSD from victim-5', (c) =>
    c.invoke('approval-drainer-1', c.sac('TUSD'), 'transfer_from',
      [addr(c.pub('approval-drainer-1')), addr(c.pub('victim-5')), addr(c.pub('approval-drainer-1')), i128(stroops(4900))])),
  fixture('mal_soroban_approve_native', 'malicious', 'soroban-approval-drain',
    'Soroban native XLM SAC approve(victim-6, approval-drainer-2, 9,000 XLM, +1,000,000 ledgers).',
    'A large, long-lived XLM allowance to an unknown spender, which is then drained via transfer_from (evidence).',
    async (c) => c.invoke('victim-6', c.sac('native'), 'approve',
      [addr(c.pub('victim-6')), addr(c.pub('approval-drainer-2')), i128(stroops(9000)), u32((await c.latestLedger()) + 1_000_000)])),
  evidence('approval-drain-native', 'approval-drainer-2 calls transfer_from to take 8,000 XLM from victim-6', (c) =>
    c.invoke('approval-drainer-2', c.sac('native'), 'transfer_from',
      [addr(c.pub('approval-drainer-2')), addr(c.pub('victim-6')), addr(c.pub('approval-drainer-2')), i128(stroops(8000))])),
  fixture('mal_multi_op_bundle', 'malicious', 'signer-takeover',
    'Three-op bundle: changeTrust RUGX + 500 XLM payment to sweeper-3 + setOptions adding takeover-attacker-3 (weight 10).',
    'An innocuous-looking first operation hides a payment to a sweeper and a signer takeover. The label follows the worst operation.',
    (c) => c.classic('victim-7', [
      Operation.changeTrust({ asset: c.asset('RUGX') }),
      pay(c.pub('sweeper-3'), 500),
      Operation.setOptions({ signer: { ed25519PublicKey: c.pub('takeover-attacker-3'), weight: 10 } })
    ])),
  fixture('mal_multi_op_hidden_merge', 'malicious', 'account-merge-drain',
    'Two-op bundle: 1 XLM to a clean merchant, then accountMerge into merge-drainer-2.',
    'A small legitimate-looking payment precedes a full-account drain.',
    (c) => c.classic('victim-merge-2', [
      pay(c.pub('clean-merchant-1'), 1),
      Operation.accountMerge({ destination: c.pub('merge-drainer-2') })
    ])),
  fixture('mal_payment_cold_start_scam', 'malicious', 'cold-start',
    '750 XLM payment to cold-start-scam-1, a freshly funded scam wallet with no history.',
    'The recipient is a scam collection wallet by construction. Its low stub score models the oracle\'s cold-start blind spot, so this fixture is an expected miss for the reputation-only path.',
    (c) => c.classic('victim-8', [pay(c.pub('cold-start-scam-1'), 750)])),
  fixture('mal_path_buy_rug_token', 'malicious', 'rug-pull',
    'Path payment strict-receive: spend up to 200 XLM to buy 1,000 RUGX from the rug issuer\'s offer.',
    'Converts real value into a token whose entire supply is controlled and dumped by the issuer.',
    (c) => c.classic('victim-3', [Operation.pathPaymentStrictReceive({
      sendAsset: Asset.native(), sendMax: '200', destination: c.pub('victim-3'),
      destAsset: c.asset('RUGX'), destAmount: '1000', path: []
    })])),
  fixture('mal_payment_phishing_drainer', 'malicious', 'phishing-drainer',
    '2,500 XLM payment from victim-8 to phishing-drainer-2, which had dusted it with a "test" payment.',
    'A large payment to a known phishing drainer.',
    (c) => c.classic('victim-8', [pay(c.pub('phishing-drainer-2'), 2500)]))
];
