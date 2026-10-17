import { capacityAt, closureOverlap, travelTimeAt } from '../../src/engine/verify.js';
import { createRng } from '../../src/engine/prng.js';
import { C, S, closure, cut, delay, net, slow, T } from './helpers.js';

/**
 * Brute-force earliest arrival: step through every hour, relaxing every connection
 * direction. Shares no code with the scheduler's search or profile arrays - it uses
 * the verifier's direct per-slot functions - and handles non-FIFO travel times naturally.
 * `usedBefore` is a Map of `${connectionId}@${slot}` -> movements already reserved.
 */
export function oracleEarliestArrival(input, usedBefore, origin, destination, start, horizon = 168) {
  const at = new Map(input.terminals.map((t) => [t.id, Infinity]));
  if (!at.has(origin) || !at.has(destination) || origin === destination || start >= horizon) return null;
  at.set(origin, start);
  for (let t = start; t < horizon; t++) {
    for (const c of input.connections) {
      const dirs = [[c.from, c.to]];
      if (c.bidirectional !== false) dirs.push([c.to, c.from]);
      for (const [from, to] of dirs) {
        if (at.get(from) > t) continue;
        const cap = capacityAt(c, t, input.disruptions);
        if ((usedBefore.get(`${c.id}@${t}`) ?? 0) >= cap) continue;
        const arrive = t + travelTimeAt(c, t, input.disruptions);
        if (arrive > horizon) continue;
        if (closureOverlap(c, t, arrive, input.disruptions)) continue;
        if (arrive < at.get(to)) at.set(to, arrive);
      }
    }
  }
  const best = at.get(destination);
  return best === Infinity ? null : best;
}

export function randomInput(seed) {
  const rng = createRng(seed);
  const n = rng.int(3, 6);
  const ids = Array.from({ length: n }, (_, i) => String.fromCharCode(65 + i));
  const connections = [];
  const connectedNetwork = rng.int(0, 4) !== 0; // 1 in 5 networks may be disconnected
  const extra = rng.int(0, 4);
  const count = connectedNetwork ? n - 1 + extra : rng.int(1, n + 1);
  for (let i = 0; i < count; i++) {
    let a;
    let b;
    if (connectedNetwork && i < n - 1) {
      a = i; // chain guarantees connectivity
      b = i + 1;
    } else {
      a = rng.int(0, n - 1);
      b = rng.int(0, n - 1);
      if (a === b) b = (b + 1) % n;
    }
    connections.push(C(`C${i + 1}`, ids[a], ids[b], rng.int(1, 4), rng.int(1, 2), rng.int(0, 9) !== 0));
  }
  const shipments = [];
  const m = rng.int(8, 45);
  for (let i = 0; i < m; i++) {
    const o = rng.int(0, n - 1);
    let d = rng.int(0, n - 1);
    if (o === d) d = (d + 1) % n;
    const late = rng.int(0, 5) === 0;
    const release = late ? rng.int(158, 167) : rng.int(0, 12);
    shipments.push(S(`S${i + 1}`, ids[o], ids[d], release, release + rng.int(1, 14), rng.int(1, 4)));
  }
  const disruptions = [];
  const dn = rng.int(0, 4);
  for (let i = 0; i < dn; i++) {
    const kind = rng.int(0, 3);
    const cid = `C${rng.int(1, count)}`;
    const start = rng.int(0, 40);
    const end = start + rng.int(1, 30);
    if (kind === 0) disruptions.push(closure(`D${i + 1}`, cid, start, end));
    else if (kind === 1) disruptions.push(slow(`D${i + 1}`, cid, start, end, rng.int(1, 5)));
    else if (kind === 2) disruptions.push(cut(`D${i + 1}`, cid, start, end, rng.int(0, 1)));
    else disruptions.push(delay(`D${i + 1}`, `S${rng.int(1, m)}`, rng.int(1, 12)));
  }
  return { ...net([], connections, shipments, disruptions), terminals: ids.map((id) => T(id)) };
}
