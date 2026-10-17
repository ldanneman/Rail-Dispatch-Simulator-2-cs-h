import { DISRUPTION, HORIZON_HOURS } from './constants.js';

/**
 * Resolve, for every connection and every hourly departure slot d in [0, horizon):
 *   travelTime[d] - base travel time + sum of active travel_time increases
 *   closed[d]     - true if a closure overlaps the traversal interval [d, d + travelTime[d])
 *   capacity[d]   - max movements that may ENTER the connection in slot d
 *                   (base capacity, lowered by capacity disruptions, 0 when closed)
 *
 * Rules (all intervals half-open):
 *  - travel_time / capacity disruptions apply by DEPARTURE slot: active when start <= d < end.
 *  - a closure [cs, ce) blocks a departure d iff d < ce && cs < d + travelTime[d].
 *    (arriving exactly at cs, or departing exactly at ce, does not overlap.)
 */
export function buildConnectionProfiles(connections, disruptions = [], horizon = HORIZON_HOURS) {
  const byConnection = new Map();
  for (const d of disruptions) {
    if (d.type === DISRUPTION.RELEASE_DELAY) continue;
    if (!byConnection.has(d.connectionId)) byConnection.set(d.connectionId, []);
    byConnection.get(d.connectionId).push(d);
  }

  const profiles = {};
  for (const c of connections) {
    const relevant = byConnection.get(c.id) ?? [];
    const travelTime = new Array(horizon);
    const capacity = new Array(horizon);
    const closed = new Array(horizon);
    for (let slot = 0; slot < horizon; slot++) {
      let tt = c.travelTime;
      let cap = c.capacity;
      for (const d of relevant) {
        if (slot < d.startHour || slot >= d.endHour) continue;
        if (d.type === DISRUPTION.TRAVEL_TIME) tt += d.extraHours;
        else if (d.type === DISRUPTION.CAPACITY) cap = Math.min(cap, d.capacity);
      }
      let isClosed = false;
      for (const d of relevant) {
        if (d.type === DISRUPTION.CLOSURE && slot < d.endHour && d.startHour < slot + tt) {
          isClosed = true;
          break;
        }
      }
      travelTime[slot] = tt;
      closed[slot] = isClosed;
      capacity[slot] = isClosed ? 0 : cap;
    }
    profiles[c.id] = { travelTime, capacity, closed };
  }
  return profiles;
}

/** Effective release time of a shipment: release + all release_delay disruptions for it. */
export function effectiveRelease(shipment, disruptions) {
  let r = shipment.release;
  for (const d of disruptions) {
    if (d.type === DISRUPTION.RELEASE_DELAY && d.shipmentId === shipment.id) r += d.delayHours;
  }
  return r;
}

export function emptyReservations(connections, horizon = HORIZON_HOURS) {
  const res = {};
  for (const c of connections) res[c.id] = new Array(horizon).fill(0);
  return res;
}
