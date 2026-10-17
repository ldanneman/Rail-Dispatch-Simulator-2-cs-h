import { compareIds } from './ids.js';

/**
 * Directed adjacency list. A bidirectional connection (default) contributes an
 * edge in each direction, but both edges reference the same connection id and
 * therefore share the same capacity reservations. Edges are sorted by connection
 * id so exploration order is deterministic.
 */
export function buildAdjacency(terminals, connections) {
  const adjacency = new Map();
  for (const t of terminals) adjacency.set(t.id, []);
  const sorted = [...connections].sort((a, b) => compareIds(a.id, b.id));
  for (const c of sorted) {
    if (!adjacency.has(c.from) || !adjacency.has(c.to)) continue;
    adjacency.get(c.from).push({ connectionId: c.id, to: c.to });
    if (c.bidirectional !== false) adjacency.get(c.to).push({ connectionId: c.id, to: c.from });
  }
  return adjacency;
}

/** Plain graph reachability, ignoring time, capacity and disruptions. */
export function isStaticallyConnected(adjacency, origin, destination) {
  if (!adjacency.has(origin) || !adjacency.has(destination)) return false;
  const seen = new Set([origin]);
  const stack = [origin];
  while (stack.length) {
    const node = stack.pop();
    if (node === destination) return true;
    for (const e of adjacency.get(node)) {
      if (!seen.has(e.to)) {
        seen.add(e.to);
        stack.push(e.to);
      }
    }
  }
  return false;
}
