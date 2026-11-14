/**
 * The fixed-seed PRNG of the 151 phase evals (mulberry32) and the campaign
 * seed. Model-free: the only randomness source of every generator, so a
 * fixed seed reproduces the committed cases.jsonl byte for byte.
 */
export const SEED = 151;

/** mulberry32 — a tiny, deterministic 32-bit PRNG. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function next(): number {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
