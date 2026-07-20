import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';

const root = fileURLToPath(new URL('..', import.meta.url));

// Stellar secret seed: starts with S, 55 alphanumeric chars, valid Ed25519 checksum
const SECRET_SEED_REGEX = /\bS[A-Z2-7]{55}\b/g;

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
        console.error(\SECRET SEED FOUND: \:\ — [REDACTED]\);
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

console.log('No Stellar secret seeds found — CI check passed.');

// Validate Ed25519 secret seed checksum (last byte is CRC16-XModem of first 55 bytes)
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
    // Last 2 bytes are CRC16-XModem checksum
    const dataBytes = bytes.slice(0, -2);
    const expected = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
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
