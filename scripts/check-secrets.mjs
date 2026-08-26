import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));

// Stellar secret seed: starts with S, 55 alphanumeric chars, valid Ed25519 checksum
const SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;

// A scanner that silently stops matching is worse than no scanner at all, so
// prove the validator still recognises a well-formed secret seed before a clean
// run is allowed to mean anything. The seed is derived at runtime from a fixed
// payload - no secret material is stored in this file.
selfTest();

// Get all tracked files
const output = execSync('git ls-files', { encoding: 'utf-8', cwd: root });
const files = output.trim().split('\n').filter(Boolean);

let found = false;

for (const file of files) {
  try {
    const content = readFileSync(join(root, file), 'utf-8');
    let match;
    while ((match = SECRET_SEED_REGEX.exec(content)) !== null) {
      const seed = match[0];
      // Validate Ed25519 secret seed checksum
      if (isValidEd25519SecretSeed(seed)) {
        const line = content.substring(0, match.index).split('\n').length;
        console.error(`SECRET SEED FOUND: ${file}:${line} - [REDACTED]`);
        found = true;
      }
    }
  } catch (e) {
    // skip binary files
  }
}

if (found) {
  console.error('CI check failed: secret seeds detected in repository. Remove them immediately.');
  process.exit(1);
}

console.log('No Stellar secret seeds found - CI check passed.');

// Validate Ed25519 secret seed checksum (trailing 2 bytes of the decoded payload)
function isValidEd25519SecretSeed(seed) {
  try {
    // Decode base32
    const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
    const bytes = [];
    let bits = 0;
    let value = 0;
    for (let i = 0; i < seed.length; i++) {
      const idx = ALPHABET.indexOf(seed[i]);
      if (idx === -1) return false;
      value = (value << 5) | idx;
      bits += 5;
      if (bits >= 8) {
        bits -= 8;
        bytes.push((value >>> bits) & 0xFF);
      }
    }
    if (bytes.length < 3) return false;
    // The trailing 2 bytes are a CRC16-XModem of everything before them,
    // appended little-endian (SEP-23). Reading them big-endian makes this
    // function reject every real strkey.
    const dataBytes = bytes.slice(0, -2);
    const expected = bytes[bytes.length - 2] | (bytes[bytes.length - 1] << 8);
    const actual = crc16xmodem(dataBytes);
    return expected === actual;
  } catch {
    return false;
  }
}

function crc16xmodem(data) {
  let crc = 0;
  for (const byte of data) {
    crc ^= byte << 8;
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x8000 ? ((crc << 1) ^ 0x1021) & 0xFFFF : (crc << 1) & 0xFFFF;
    }
  }
  return crc;
}

function selfTest() {
  const body = [18 << 3, ...new Array(32).fill(7)]; // version byte for an ed25519 secret seed
  const crc = crc16xmodem(body);
  const knownGood = base32Encode([...body, crc & 0xFF, (crc >>> 8) & 0xFF]);

  const matches = SECRET_SEED_REGEX.test(knownGood);
  SECRET_SEED_REGEX.lastIndex = 0; // .test() on a /g regex advances lastIndex

  if (!matches || !isValidEd25519SecretSeed(knownGood)) {
    console.error('check-secrets self-test failed: this scanner no longer recognises a valid');
    console.error('Stellar secret seed, so a clean result would be meaningless. Fix the detector.');
    process.exit(1);
  }
}

function base32Encode(bytes) {
  const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let out = '';
  let bits = 0;
  let value = 0;
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      out += ALPHABET[(value >>> bits) & 0x1F];
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 0x1F];
  return out;
}
