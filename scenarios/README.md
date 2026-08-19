# Scenario Bundles

A **scenario bundle** groups several labelled point fixtures into one ordered,
multi-transaction attack workflow whose risk emerges from the *sequence*, not
from any single isolated transaction. Scenario bundles are versioned, machine
checkable, and replayable entirely offline.

> **Synthetic-only.** Scenarios never fetch live transactions, never touch the
> network, and never run a blockchain indexer. Every "actual" value a replay
> produces is derived deterministically from fixtures already checked into this
> repository. Do not add real, attributable addresses or live-chain data here.

## Backward compatibility

Scenarios are **additive**. Existing point fixtures keep working exactly as
before:

- `destinations.json` — labelled accounts and assets (unchanged)
- `scores.json` — 0–100 stub scores (unchanged)
- `transactions/*.xdr` — unsigned sample XDRs (unchanged)

Nothing in `destinations.json`, `scores.json`, or `transactions/` is forced to
become a scenario. Downstream consumers (`grydlock-oracle-adapter`,
`grydlock-research`) continue to load point fixtures directly. The scenario
system is a new layer on top that *references* those fixtures by stable id.

## Schema version

Every scenario declares a `schema_version` string. The only supported version
is:

- **`1.0`**

An unsupported or malformed `schema_version` is rejected loudly — it is never
silently interpreted. On failure you will see the offending version and the
supported versions.

## Anatomy of a scenario

A scenario is a single JSON object:

| Field | Type | Required | Meaning |
| --- | --- | --- | --- |
| `schema_version` | string | yes | `"1.0"` |
| `id` | string | yes | stable scenario id (`[A-Za-z0-9][A-Za-z0-9._-]*`) |
| `name` | string | yes | short human-readable name |
| `description` | string | no | free-text rationale |
| `participants` | array | yes | at least one participant |
| `steps` | array | yes | at least one ordered step |

### Participants

```json
{ "id": "victim", "destination": "GCRRYBV5IY7..." }
```

A participant is a *role* in the workflow (e.g. `victim`, `attacker`), bound to
an existing destination fixture so it carries a well-defined initial risk tier.

| Field | Meaning |
| --- | --- |
| `id` | stable, unique participant id |
| `destination` | an existing destination id from `destinations.json` |

The participant's initial risk tier is the destination's `label`
(`clean | suspicious | malicious`). Large fixture objects are not duplicated —
participants reference destinations by id.

### Steps

```json
{
  "id": "suspicious-interaction",
  "sequence": 2,
  "transaction": "payment",
  "destination": "GCRNKXJJLZNDLK2EWPX25JISTORCXCF2HYUXMYKF7XWKHMEOHCXVGP4J",
  "participants": ["victim"],
  "expected_warnings": [
    { "risk_pattern": "pass-through", "expected": true, "severity": "suspicious" }
  ],
  "expected_state": [
    { "participant": "victim", "tier": "suspicious" }
  ]
}
```

| Field | Meaning |
| --- | --- |
| `id` | stable, unique step id |
| `sequence` | positive integer; steps execute in ascending `sequence` order |
| `transaction` | an existing transaction fixture id (the `.xdr` filename stem, e.g. `payment`) |
| `destination` | an existing destination id from `destinations.json` |
| `participants` | one or more participant ids involved in this step |
| `expected_warnings` | machine-checkable warning expectations (may be empty) |
| `expected_state` | machine-checkable post-step tier expectations |

Every step must declare at least one expected outcome (`expected_warnings`
and/or `expected_state`).

### References

All three reference kinds are validated the same way:

- **participant reference** — must name a participant declared in `participants`
- **destination reference** — must match an entry in `destinations.json`
- **transaction reference** — must match a `transactions/*.xdr` filename stem

Each is checked for three failure modes:

1. **missing** — the field is absent
2. **malformed** — present but not a non-empty string
3. **unknown** — a string that does not resolve

### Deterministic ordering

Steps execute in ascending `sequence` order. The following are all rejected:

- duplicate step ids
- duplicate sequence numbers
- missing `sequence`
- non-integer / non-positive `sequence`

Execution order never depends on filesystem ordering, object iteration order,
wall-clock time, or network state.

## Expected warnings

A warning is keyed by a destination's `risk_pattern` (the category) and carries
the destination's `label` as severity. The taxonomy is the same one used by
`destinations.json`:

`sweep`, `phishing-drainer`, `rug-pull`, `pass-through`, `scam-trustline`,
`signer-takeover`, `memo-impersonation`, `sponsored-mule`, `cold-start`,
`adversarial-clean` (plus `none`, which never produces a warning).

An expectation is one of:

```json
{ "risk_pattern": "phishing-drainer", "expected": true }
{ "risk_pattern": "sweep", "expected": false }
{ "risk_pattern": "pass-through", "expected": true, "severity": "suspicious" }
```

- `expected: true` — the category **must** fire for this step
- `expected: false` — the category **must not** fire for this step
- `severity` (optional) — the fired warning's label must match

Replay compares the full expected/actual warning sets: a category that fires
without being declared `expected: true` is an "unexpected warning" and fails.

## Expected state transitions

The replay maintains one risk tier per participant, ordered
`clean < suspicious < malicious`. Each participant starts at its own
destination's label, then escalates monotonically as it interacts with riskier
destinations:

```
new tier = max(current tier, label of the step's destination)
```

`expected_state` is a list of post-step assertions:

```json
{ "participant": "victim", "tier": "suspicious" }
```

After applying a step, the participant's actual tier is compared to the
expected tier. Any mismatch fails replay.

## Validating and replaying

```bash
# validate every scenario in scenarios/ (schema + references + ordering)
npm run validate:scenarios

# validate everything (point fixtures + scenarios)
npm run validate

# replay a single scenario deterministically, offline
npm run replay -- scenarios/phishing-drain.json

# run the test suite
npm test
```

`npm run replay` returns exit code `0` on success and non-zero on any
validation or outcome mismatch, with errors that name the scenario, step,
field, and reason:

```
Scenario validation failed:
  scenario "phishing-drain-01"
  step "follow-up-drain"
  destination "attacker-destination" was not found
```

## Complete example

See [`phishing-drain.json`](./phishing-drain.json). The workflow:

```
initial funding (clean, no warning)
→ suspicious interaction (pass-through warning)
→ follow-up drain (phishing-drainer warning)
```

The victim's tier escalates `clean → suspicious → malicious` across the three
steps, which is what makes the *sequence* — not any single step — the attack.
