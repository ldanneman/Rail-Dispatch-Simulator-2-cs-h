import { HORIZON_HOURS } from './constants.js';
import { compareIds } from './ids.js';

/**
 * Best way to take one connection when the shipment is ready at `ready`.
 * Scans departure slots d = ready .. horizon-1 and returns the movement with the
 * earliest ARRIVAL (ties: earliest departure). Scanning (rather than taking the
 * first free slot) matters because a travel-time disruption can make a later
 * departure arrive earlier than an earlier one.
 */
export function bestMovement(profile, used, ready, horizon = HORIZON_HOURS) {
  let best = null;
  for (let d = Math.max(0, ready); d < horizon; d++) {
    // Any departure at or after d arrives no earlier than d + 1.
    if (best && best.arrive <= d + 1) break;
    if (profile.capacity[d] - used[d] <= 0) continue;
    const arrive = d + profile.travelTime[d];
    if (arrive > horizon) continue;
    if (!best || arrive < best.arrive) best = { depart: d, arrive, travelTime: profile.travelTime[d] };
  }
  return best;
}

function labelBefore(a, aId, b, bId) {
  if (a.arrival !== b.arrival) return a.arrival < b.arrival;
  if (a.hops !== b.hops) return a.hops < b.hops;
  return compareIds(aId, bId) < 0;
}

/**
 * Earliest-arrival route through the time-expanded network (Dijkstra over
 * terminals, where edge cost is time-dependent). Waiting at terminals is free
 * and unlimited, so "arrive earlier" always dominates "arrive later" and the
 * label-setting search is exact for the given capacity reservations.
 *
 * Ties: earlier arrival, then fewer legs, then lower terminal id (settle order).
 * A label is replaced only by a strictly better (arrival, legs) pair.
 *
 * Returns { arrival, legs: [{connectionId, from, to, depart, arrive, travelTime}] } or null.
 */
export function findEarliestRoute({
  adjacency,
  profiles,
  reservations,
  origin,
  destination,
  startTime,
  horizon = HORIZON_HOURS,
}) {
  if (!adjacency.has(origin) || !adjacency.has(destination) || origin === destination) return null;
  if (startTime >= horizon) return null;

  const labels = new Map([[origin, { arrival: startTime, hops: 0, prev: null }]]);
  const settled = new Set();

  for (;;) {
    let bestId = null;
    let best = null;
    for (const [id, label] of labels) {
      if (settled.has(id)) continue;
      if (best === null || labelBefore(label, id, best, bestId)) {
        best = label;
        bestId = id;
      }
    }
    if (best === null) return null;
    if (bestId === destination) break;
    settled.add(bestId);

    for (const edge of adjacency.get(bestId)) {
      if (settled.has(edge.to)) continue;
      const profile = profiles[edge.connectionId];
      if (!profile) continue;
      const move = bestMovement(profile, reservations[edge.connectionId], best.arrival, horizon);
      if (!move) continue;
      const current = labels.get(edge.to);
      const hops = best.hops + 1;
      if (!current || move.arrive < current.arrival || (move.arrive === current.arrival && hops < current.hops)) {
        labels.set(edge.to, {
          arrival: move.arrive,
          hops,
          prev: {
            node: bestId,
            connectionId: edge.connectionId,
            depart: move.depart,
            arrive: move.arrive,
            travelTime: move.travelTime,
          },
        });
      }
    }
  }

  const legs = [];
  let node = destination;
  let label = labels.get(node);
  const arrival = label.arrival;
  while (label.prev) {
    const p = label.prev;
    legs.push({
      connectionId: p.connectionId,
      from: p.node,
      to: node,
      depart: p.depart,
      arrive: p.arrive,
      travelTime: p.travelTime,
    });
    node = p.node;
    label = labels.get(node);
  }
  legs.reverse();
  return { arrival, legs };
}
