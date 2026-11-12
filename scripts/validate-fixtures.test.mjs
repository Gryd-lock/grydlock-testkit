/**
 * Tests for label-to-score-band consistency (issue #62).
 *
 * Covers:
 *  - Boundary values (min and max of each band)
 *  - Values in intentional gaps (26–39 and 71–74)
 *  - Values just outside each band edge
 *  - Mismatched label/score combinations
 *  - All three valid labels at their boundaries
 *
 * Run with:  npm test
 */

import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { SCORE_BANDS, scoreMatchesBand, bandRangeLabel } from './validate-fixtures.mjs';

// ---------------------------------------------------------------------------
// SCORE_BANDS shape
// ---------------------------------------------------------------------------

describe('SCORE_BANDS', () => {
  it('exports bands for all three labels', () => {
    assert.ok(SCORE_BANDS.clean,      'clean band missing');
    assert.ok(SCORE_BANDS.suspicious, 'suspicious band missing');
    assert.ok(SCORE_BANDS.malicious,  'malicious band missing');
  });

  it('clean band is 0–25', () => {
    assert.equal(SCORE_BANDS.clean.min, 0);
    assert.equal(SCORE_BANDS.clean.max, 25);
  });

  it('suspicious band is 40–70', () => {
    assert.equal(SCORE_BANDS.suspicious.min, 40);
    assert.equal(SCORE_BANDS.suspicious.max, 70);
  });

  it('malicious band is 75–100', () => {
    assert.equal(SCORE_BANDS.malicious.min, 75);
    assert.equal(SCORE_BANDS.malicious.max, 100);
  });
});

// ---------------------------------------------------------------------------
// bandRangeLabel
// ---------------------------------------------------------------------------

describe('bandRangeLabel', () => {
  it('returns "0–25" for clean', () => {
    assert.equal(bandRangeLabel('clean'), '0–25');
  });
  it('returns "40–70" for suspicious', () => {
    assert.equal(bandRangeLabel('suspicious'), '40–70');
  });
  it('returns "75–100" for malicious', () => {
    assert.equal(bandRangeLabel('malicious'), '75–100');
  });
  it('returns "unknown" for an unrecognised label', () => {
    assert.equal(bandRangeLabel('unknown-label'), 'unknown');
  });
});

// ---------------------------------------------------------------------------
// scoreMatchesBand — clean (0–25)
// ---------------------------------------------------------------------------

describe('scoreMatchesBand — clean', () => {
  // Lower boundary
  it('accepts lower boundary: 0', () => assert.ok(scoreMatchesBand('clean', 0)));
  it('accepts score 1 (just above lower boundary)', () => assert.ok(scoreMatchesBand('clean', 1)));

  // Upper boundary
  it('accepts upper boundary: 25', () => assert.ok(scoreMatchesBand('clean', 25)));
  it('accepts score 24 (just below upper boundary)', () => assert.ok(scoreMatchesBand('clean', 24)));

  // Mid-band values from existing fixtures
  it('accepts existing fixture score 2', () => assert.ok(scoreMatchesBand('clean', 2)));
  it('accepts existing fixture score 3', () => assert.ok(scoreMatchesBand('clean', 3)));
  it('accepts existing fixture score 4', () => assert.ok(scoreMatchesBand('clean', 4)));
  it('accepts existing fixture score 6', () => assert.ok(scoreMatchesBand('clean', 6)));

  // Just outside upper boundary — intentional gap starts at 26
  it('rejects score 26 (first value in gap 26–39)', () => assert.ok(!scoreMatchesBand('clean', 26)));
  it('rejects score 39 (last value in gap 26–39)',  () => assert.ok(!scoreMatchesBand('clean', 39)));

  // Wrong band entirely
  it('rejects suspicious-range score 55', () => assert.ok(!scoreMatchesBand('clean', 55)));
  it('rejects malicious-range score 85',  () => assert.ok(!scoreMatchesBand('clean', 85)));
});

// ---------------------------------------------------------------------------
// scoreMatchesBand — suspicious (40–70)
// ---------------------------------------------------------------------------

describe('scoreMatchesBand — suspicious', () => {
  // Lower boundary
  it('accepts lower boundary: 40', () => assert.ok(scoreMatchesBand('suspicious', 40)));
  it('accepts score 41 (just above lower boundary)', () => assert.ok(scoreMatchesBand('suspicious', 41)));

  // Upper boundary
  it('accepts upper boundary: 70', () => assert.ok(scoreMatchesBand('suspicious', 70)));
  it('accepts score 69 (just below upper boundary)', () => assert.ok(scoreMatchesBand('suspicious', 69)));

  // Mid-band values from existing fixtures
  it('accepts existing fixture score 55', () => assert.ok(scoreMatchesBand('suspicious', 55)));
  it('accepts existing fixture score 58', () => assert.ok(scoreMatchesBand('suspicious', 58)));
  it('accepts existing fixture score 62', () => assert.ok(scoreMatchesBand('suspicious', 62)));

  // Below lower boundary — gap ends at 39, band starts at 40
  it('rejects score 39 (last value in gap 26–39)', () => assert.ok(!scoreMatchesBand('suspicious', 39)));
  it('rejects score 25 (clean upper boundary)',    () => assert.ok(!scoreMatchesBand('suspicious', 25)));

  // Above upper boundary — intentional gap 71–74
  it('rejects score 71 (first value in gap 71–74)', () => assert.ok(!scoreMatchesBand('suspicious', 71)));
  it('rejects score 74 (last value in gap 71–74)',  () => assert.ok(!scoreMatchesBand('suspicious', 74)));

  // Wrong band entirely
  it('rejects clean-range score 10',     () => assert.ok(!scoreMatchesBand('suspicious', 10)));
  it('rejects malicious-range score 90', () => assert.ok(!scoreMatchesBand('suspicious', 90)));
});

// ---------------------------------------------------------------------------
// scoreMatchesBand — malicious (75–100)
// ---------------------------------------------------------------------------

describe('scoreMatchesBand — malicious', () => {
  // Lower boundary
  it('accepts lower boundary: 75', () => assert.ok(scoreMatchesBand('malicious', 75)));
  it('accepts score 76 (just above lower boundary)', () => assert.ok(scoreMatchesBand('malicious', 76)));

  // Upper boundary
  it('accepts upper boundary: 100', () => assert.ok(scoreMatchesBand('malicious', 100)));
  it('accepts score 99 (just below upper boundary)', () => assert.ok(scoreMatchesBand('malicious', 99)));

  // Mid-band values from existing fixtures
  it('accepts existing fixture score 85', () => assert.ok(scoreMatchesBand('malicious', 85)));
  it('accepts existing fixture score 89', () => assert.ok(scoreMatchesBand('malicious', 89)));
  it('accepts existing fixture score 92', () => assert.ok(scoreMatchesBand('malicious', 92)));
  it('accepts existing fixture score 95', () => assert.ok(scoreMatchesBand('malicious', 95)));
  it('accepts existing fixture score 97', () => assert.ok(scoreMatchesBand('malicious', 97)));

  // Below lower boundary — gap 71–74 ends at 74, band starts at 75
  it('rejects score 74 (last value in gap 71–74)', () => assert.ok(!scoreMatchesBand('malicious', 74)));
  it('rejects score 70 (suspicious upper boundary)', () => assert.ok(!scoreMatchesBand('malicious', 70)));

  // Wrong band entirely
  it('rejects clean-range score 5',       () => assert.ok(!scoreMatchesBand('malicious', 5)));
  it('rejects suspicious-range score 60', () => assert.ok(!scoreMatchesBand('malicious', 60)));
});

// ---------------------------------------------------------------------------
// Intentional gap values — must fail ALL labels
// ---------------------------------------------------------------------------

describe('intentional gap values (26–39 and 71–74) are rejected by all labels', () => {
  for (const gapScore of [26, 30, 35, 39, 71, 72, 73, 74]) {
    it(`score ${gapScore} is rejected by clean`,      () => assert.ok(!scoreMatchesBand('clean', gapScore)));
    it(`score ${gapScore} is rejected by suspicious`, () => assert.ok(!scoreMatchesBand('suspicious', gapScore)));
    it(`score ${gapScore} is rejected by malicious`,  () => assert.ok(!scoreMatchesBand('malicious', gapScore)));
  }
});

// ---------------------------------------------------------------------------
// Cross-label mismatch scenarios (the core issue #62 case)
// ---------------------------------------------------------------------------

describe('cross-label mismatch detection', () => {
  it('clean label with a suspicious-range score (55) is rejected', () => {
    assert.ok(!scoreMatchesBand('clean', 55));
  });
  it('clean label with a malicious-range score (90) is rejected', () => {
    assert.ok(!scoreMatchesBand('clean', 90));
  });
  it('suspicious label with a clean-range score (10) is rejected', () => {
    assert.ok(!scoreMatchesBand('suspicious', 10));
  });
  it('suspicious label with a malicious-range score (80) is rejected', () => {
    assert.ok(!scoreMatchesBand('suspicious', 80));
  });
  it('malicious label with a clean-range score (15) is rejected', () => {
    assert.ok(!scoreMatchesBand('malicious', 15));
  });
  it('malicious label with a suspicious-range score (65) is rejected', () => {
    assert.ok(!scoreMatchesBand('malicious', 65));
  });
});

// ---------------------------------------------------------------------------
// Unknown / invalid label
// ---------------------------------------------------------------------------

describe('scoreMatchesBand with invalid label', () => {
  it('returns false for an unknown label', () => {
    assert.ok(!scoreMatchesBand('unknown', 50));
  });
  it('returns false for an empty label', () => {
    assert.ok(!scoreMatchesBand('', 50));
  });
});
