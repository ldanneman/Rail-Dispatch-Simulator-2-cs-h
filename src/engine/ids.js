// Deterministic "natural" ID comparison (S2 < S10). Uses code-unit comparison
// for text chunks so the order never depends on the runtime's locale/ICU data.

const CHUNK = /(\d+)|(\D+)/g;

export function compareIds(a, b) {
  if (a === b) return 0;
  const ca = String(a).match(CHUNK) ?? [];
  const cb = String(b).match(CHUNK) ?? [];
  const n = Math.min(ca.length, cb.length);
  for (let i = 0; i < n; i++) {
    const x = ca[i];
    const y = cb[i];
    if (x === y) continue;
    const xd = x[0] >= '0' && x[0] <= '9';
    const yd = y[0] >= '0' && y[0] <= '9';
    if (xd && yd) {
      const dx = x.replace(/^0+(?=\d)/, '');
      const dy = y.replace(/^0+(?=\d)/, '');
      if (dx.length !== dy.length) return dx.length < dy.length ? -1 : 1;
      if (dx !== dy) return dx < dy ? -1 : 1;
      // numerically equal but differently padded: shorter literal first
      if (x.length !== y.length) return x.length < y.length ? -1 : 1;
      continue;
    }
    return x < y ? -1 : 1;
  }
  if (ca.length !== cb.length) return ca.length < cb.length ? -1 : 1;
  return a < b ? -1 : 1;
}

/** Largest trailing/embedded integer found in a list of ids (0 if none). */
export function maxIdNumber(ids) {
  let max = 0;
  for (const id of ids) {
    const m = String(id).match(/(\d+)\D*$/);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
