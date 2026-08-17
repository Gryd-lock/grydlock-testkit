/**
 * Minimal Stellar strkey encoder, used only to mint *synthetic* account
 * public keys for benchmark corpora.
 *
 * Only the `G...` (ed25519 public key) form is implemented on purpose: the
 * benchmark corpora must never contain anything that could be mistaken for a
 * secret seed, and `scripts/check-secrets.mjs` guards the repository against
 * exactly that.
 */

const BASE32_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

/** Version byte for an ed25519 public key: 6 << 3. */
const VERSION_BYTE_ACCOUNT_ID = 6 << 3;

function crc16xmodem(bytes) {
  let crc = 0;
  for (const byte of bytes) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
    }
  }
  return crc;
}

function base32Encode(bytes) {
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += BASE32_ALPHABET[(value >>> bits) & 0x1f];
    }
  }
  if (bits > 0) {
    out += BASE32_ALPHABET[(value << (5 - bits)) & 0x1f];
  }
  return out;
}

/**
 * Encode 32 raw bytes as a Stellar account public key (`G...`, 56 chars).
 *
 * @param {Uint8Array} payload 32-byte ed25519 public key material
 * @returns {string}
 */
export function encodeAccountId(payload) {
  if (payload.length !== 32) {
    throw new Error(`expected 32-byte payload, got ${payload.length}`);
  }
  const body = new Uint8Array(1 + 32);
  body[0] = VERSION_BYTE_ACCOUNT_ID;
  body.set(payload, 1);

  const checksum = crc16xmodem(body);
  const full = new Uint8Array(body.length + 2);
  full.set(body, 0);
  // CRC16 is appended little-endian.
  full[body.length] = checksum & 0xff;
  full[body.length + 1] = (checksum >>> 8) & 0xff;

  return base32Encode(full);
}

/**
 * Deterministic 32-bit PRNG (mulberry32). Seeded runs make every corpus in
 * this harness byte-for-byte reproducible across machines and CI.
 *
 * @param {number} seed
 * @returns {() => number} generator returning floats in [0, 1)
 */
export function seededRandom(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
