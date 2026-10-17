// mulberry32: tiny seeded PRNG. Integer arithmetic only, so a seed produces the
// same sequence in every JavaScript engine.
export function createRng(seed) {
  let a = seed >>> 0;
  const next = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  return {
    next,
    /** integer in [min, max] inclusive */
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    /** pick an index according to non-negative integer weights */
    weighted: (weights) => {
      const total = weights.reduce((s, w) => s + w, 0);
      let r = Math.floor(next() * total);
      for (let i = 0; i < weights.length; i++) {
        if (r < weights[i]) return i;
        r -= weights[i];
      }
      return weights.length - 1;
    },
  };
}
