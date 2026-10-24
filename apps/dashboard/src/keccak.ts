/**
 * Minimal keccak-256 (pre-standard SHA3 padding) used only to derive 4-byte
 * function selectors for owner calldata builders (pause/unpause on the Aegis
 * account). Verified against the reference vectors below before use:
 *   keccak256("")                = c5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a456
 *   keccak256("pause()")[0..3]   = 8456cb59   (AegisAccount.sol, function pause())
 *   keccak256("unpause()")[0..3] = 3f4ba83a   (AegisAccount.sol, function unpause())
 */

const RC = [
  0x0000000000000001n, 0x0000000000008082n, 0x800000000000808an, 0x8000000080008000n,
  0x000000000000808bn, 0x0000000080000001n, 0x8000000080008081n, 0x8000000000008009n,
  0x000000000000008an, 0x0000000000000088n, 0x0000000080008009n, 0x000000008000000an,
  0x000000008000808bn, 0x800000000000008bn, 0x8000000000008089n, 0x8000000000008003n,
  0x8000000000008002n, 0x8000000000000080n, 0x000000000000800an, 0x800000008000000an,
  0x8000000080008081n, 0x8000000000008080n, 0x0000000080000001n, 0x8000000080008008n,
] as const;

const MASK = 0xffffffffffffffffn;

/** Rotation offsets, indexed as ROT[x + 5 * y], generated per FIPS 202. */
const ROT = [
  0, 1, 62, 28, 27,
  36, 44, 6, 55, 20,
  3, 10, 43, 25, 39,
  41, 45, 15, 21, 8,
  18, 2, 61, 56, 14,
] as const;

function rotl(value: bigint, shift: number): bigint {
  const n = BigInt(shift);
  return ((value << n) | (value >> (64n - n))) & MASK;
}

function keccakF(state: bigint[]): void {
  for (let round = 0; round < 24; round += 1) {
    const c: bigint[] = [];
    for (let x = 0; x < 5; x += 1) {
      c[x] = state[x] ^ state[x + 5] ^ state[x + 10] ^ state[x + 15] ^ state[x + 20];
    }
    for (let x = 0; x < 5; x += 1) {
      const d = c[(x + 4) % 5] ^ rotl(c[(x + 1) % 5], 1);
      for (let y = 0; y < 25; y += 5) state[y + x] = (state[y + x] ^ d) & MASK;
    }
    const b: bigint[] = new Array(25).fill(0n);
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        const index = x + 5 * y;
        b[y + ((2 * x + 3 * y) % 5) * 5] = rotl(state[index], ROT[index]);
      }
    }
    for (let x = 0; x < 5; x += 1) {
      for (let y = 0; y < 5; y += 1) {
        state[x + 5 * y] = b[x + 5 * y] ^ ((~b[(x + 1) % 5 + 5 * y] & MASK) & b[(x + 2) % 5 + 5 * y]);
      }
    }
    state[0] = (state[0] ^ RC[round]) & MASK;
  }
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function keccak256Hex(input: string | Uint8Array): string {
  const message = typeof input === "string" ? utf8Bytes(input) : input;
  const rate = 136; // 1088-bit rate for 256-bit output
  const padded = new Uint8Array(Math.ceil((message.length + 1) / rate) * rate);
  padded.set(message);
  padded[message.length] = 0x01; // keccak padding: 0x01 ... 0x80
  padded[padded.length - 1] |= 0x80;

  const state: bigint[] = new Array(25).fill(0n);
  for (let offset = 0; offset < padded.length; offset += rate) {
    for (let lane = 0; lane < rate / 8; lane += 1) {
      let laneValue = 0n;
      for (let i = 7; i >= 0; i -= 1) {
        laneValue = (laneValue << 8n) | BigInt(padded[offset + lane * 8 + i]);
      }
      state[lane] ^= laneValue;
    }
    keccakF(state);
  }

  let hash = "";
  for (let lane = 0; lane < 4; lane += 1) {
    let laneValue = state[lane];
    for (let i = 0; i < 8; i += 1) {
      hash += (laneValue & 0xffn).toString(16).padStart(2, "0");
      laneValue >>= 8n;
    }
  }
  return hash;
}

/** 4-byte function selector for a canonical signature like "pause()". */
export function functionSelector(signature: string): `0x${string}` {
  return `0x${keccak256Hex(signature).slice(0, 8)}` as `0x${string}`;
}
