import crypto from 'node:crypto';

/** Deterministic PRNG (mulberry32) seeded from a SHA-256 digest of a string seed. */
export function createSeededRandom(seed: string): () => number {
  const hash = crypto.createHash('sha256').update(seed).digest();
  let state = hash.readUInt32LE(0) || 1;
  return function next(): number {
    state |= 0;
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick<T>(rng: () => number, items: readonly T[]): T {
  const item = items[Math.floor(rng() * items.length)];
  if (item === undefined) throw new Error('pick() called with empty array');
  return item;
}
