# Repository Governance & Branch Protection Policy

This document defines the branch protection rules, required status checks, and review requirements that govern merges into `main` in [`Gryd-lock/grydlock-testkit`](https://github.com/Gryd-lock/grydlock-testkit).

Because `grydlock-testkit` is the canonical ground-truth evaluation dataset consumed by `grydlock-oracle-adapter`, `grydlock-extension`, and `grydlock-research`, **no pull request may be merged into `main` while any CI validation job is failing.**

---

## 1. Required Status Checks on `main`

Every pull request targeting `main` triggers `.github/workflows/ci.yml` and `.github/workflows/consumer-contract-test.yml`. Branch protection on `main` requires the following status checks to pass (`strict: true` — branches must be up to date with `main` before merging):

| Required status check name | Workflow file | Job ID | What it enforces |
|---|---|---|---|
| **`Check for Stellar secret seeds`** | `.github/workflows/ci.yml` | `secret-check` | Runs `node scripts/check-secrets.mjs` across all git-tracked files and rejects any commit containing a valid SEP-23 Ed25519 secret seed (`S...` with valid CRC16-XModem checksum). |
| **`validate`** | `.github/workflows/ci.yml` | `validate` | Runs `npm ci`, `npm run validate` (`validate-fixtures.mjs`, `validate-transactions.mjs`, `validate-scenarios.mjs`), and `npm test` (`node --test`). Blocks any broken XDR envelope, hash mismatch, schema error, or unannotated out-of-band stub score. |
| **`Changelog updated`** | `.github/workflows/ci.yml` | `validate-changelog` | When `destinations.json`, `scores.json`, or `transactions/*.xdr` are modified in a PR, verifies that the `## [Unreleased]` section of `CHANGELOG.md` is populated. |
| **`Adapter contract + extension file resolution`** | `.github/workflows/consumer-contract-test.yml` | `consumer-contract` | Packs the candidate `grydlock-testkit` tarball (`npm pack`) and verifies that `grydlock-oracle-adapter` and extension-style file resolution succeed without regressions. |

---

## 2. Pull Request & Review Requirements

1. **No direct pushes or force-pushes to `main`:**
   - Force-pushes (`allow_force_pushes: false`) and branch deletions (`allow_deletions: false`) on `main` are blocked for all users, including administrators (`enforce_admins: true`).
   - All changes must arrive via a pull request so `.github/workflows/ci.yml` (including the `pull_request`-scoped `validate-changelog` job) runs before merge.
2. **Required approving reviews:**
   - At least **1 approving review** (`required_approving_review_count: 1`) from a repository maintainer / code owner is required before merging.
   - Stale approvals are dismissed automatically when new commits are pushed to the PR branch (`dismiss_stale_reviews: true`).
   - Pull requests that modify `destinations.json`, `scores.json`, or `transactions/*.xdr` must be reviewed against the checklist in [CONTRIBUTING.md](CONTRIBUTING.md) and the rubric in [docs/LABELS.md](docs/LABELS.md).
3. **Conversation resolution:**
   - All review threads must be resolved (`required_conversation_resolution: true`) before merging.

---

## 3. Auditing & Applying Branch Protection via GitHub CLI (`gh api`)

### 3a. Audit current branch protection on `main`

Any maintainer with repository admin permissions can inspect the live protection rules on `main` using:

```sh
gh api repos/Gryd-lock/grydlock-testkit/branches/main/protection \
  --jq '{
    strict: .required_status_checks.strict,
    contexts: .required_status_checks.contexts,
    enforce_admins: .enforce_admins.enabled,
    required_approving_review_count: .required_pull_request_reviews.required_approving_review_count,
    dismiss_stale_reviews: .required_pull_request_reviews.dismiss_stale_reviews,
    require_code_owner_reviews: .required_pull_request_reviews.require_code_owner_reviews,
    allow_force_pushes: .allow_force_pushes.enabled,
    allow_deletions: .allow_deletions.enabled,
    required_conversation_resolution: .required_conversation_resolution.enabled
  }'
```

*(Note: Querying `/branches/main/protection` requires repository admin permissions; unprivileged tokens receive `HTTP 403/404` from the GitHub REST API even when rules are active.)*

### 3b. Apply or restore the canonical branch protection configuration

Maintainers with admin access can apply the exact required configuration idempotently with a single `gh api` command:

```sh
gh api --method PUT repos/Gryd-lock/grydlock-testkit/branches/main/protection \
  -H "Accept: application/vnd.github+json" \
  --input - <<'EOF'
{
  "required_status_checks": {
    "strict": true,
    "contexts": [
      "Check for Stellar secret seeds",
      "validate",
      "Changelog updated",
      "Adapter contract + extension file resolution"
    ]
  },
  "enforce_admins": true,
  "required_pull_request_reviews": {
    "dismiss_stale_reviews": true,
    "require_code_owner_reviews": true,
    "required_approving_review_count": 1,
    "require_last_push_approval": false
  },
  "restrictions": null,
  "required_linear_history": true,
  "allow_force_pushes": false,
  "allow_deletions": false,
  "block_creations": false,
  "required_conversation_resolution": true,
  "lock_branch": false,
  "allow_fork_syncing": true
}
EOF
```

### 3c. Equivalent GitHub UI Settings Checklist

If configuring via **Settings → Branches → Branch protection rules (`main`)**:

- [x] **Require a pull request before merging**
  - [x] Require approvals (`1`)
  - [x] Dismiss stale pull request approvals when new commits are pushed
  - [x] Require review from Code Owners (protects `destinations.json`, `scores.json`, `transactions/`)
- [x] **Require status checks to pass before merging**
  - [x] Require branches to be up to date before merging
  - Status checks required:
    - `Check for Stellar secret seeds`
    - `validate`
    - `Changelog updated`
    - `Adapter contract + extension file resolution`
- [x] **Require conversation resolution before merging**
- [x] **Require linear history**
- [x] **Do not allow bypassing the above settings** (Include administrators)
- [ ] Allow force pushes (**Unchecked / Disabled**)
- [ ] Allow deletions (**Unchecked / Disabled**)

---

## 4. Verifying That a Failing `validate` Check Blocks Merge

To verify the protection rule end-to-end without polluting `main`:

1. Open a draft test branch modifying `destinations.json` with an invalid label (e.g. `"label": "unknown-tier"`).
2. Confirm that `npm run validate` exits with code `1` in the `validate` GitHub Actions job (`Fixture validation failed`).
3. Confirm in the GitHub PR UI that merging is blocked with **"Merging is blocked — Waiting on code owner review and required status check `validate`."**
4. Close and delete the test branch once verified.
