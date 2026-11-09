/**
 * Deterministic stub lookup modelled on grydlock-oracle-adapter `StubOracle`.
 *
 * StubOracle.getScore() returns DEFAULT_SCORE (0) for unrecognized
 * destinations so the extension always has a number to render. That collapses
 * "unknown" into "low-risk". This evaluator keeps the fallback visible but
 * classifies unknown destinations as `unscored`, not `low`.
 */

export const STUB_DEFAULT_SCORE = 0;

export function createDestinationIndex(destinations) {
  const byId = new Map();
  for (const destination of destinations) {
    byId.set(destination.id, destination);
    if (destination.address && destination.address !== destination.id) {
      byId.set(destination.address, destination);
    }
  }
  return byId;
}

export function stubLookup(destination, scores, destinationsById) {
  if (destination in scores) {
    const record = destinationsById.get(destination);
    return {
      status: 'known',
      destination,
      score: scores[destination],
      stubOracleScore: scores[destination],
      expectedLabel: record?.label ?? null,
    };
  }

  return {
    status: 'unknown',
    destination,
    score: null,
    stubOracleScore: STUB_DEFAULT_SCORE,
    expectedLabel: null,
  };
}
