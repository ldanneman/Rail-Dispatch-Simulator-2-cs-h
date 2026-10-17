import { DISRUPTION, FAILURE, HORIZON_HOURS } from './constants.js';
import { buildConnectionProfiles, effectiveRelease, emptyReservations } from './profile.js';
import { isStaticallyConnected } from './network.js';
import { findEarliestRoute } from './search.js';

export function describeDisruption(d) {
  switch (d.type) {
    case DISRUPTION.CLOSURE:
      return `closure of ${d.connectionId} [${d.startHour}, ${d.endHour})`;
    case DISRUPTION.TRAVEL_TIME:
      return `+${d.extraHours}h travel time on ${d.connectionId} [${d.startHour}, ${d.endHour})`;
    case DISRUPTION.CAPACITY:
      return `capacity cut to ${d.capacity}/h on ${d.connectionId} [${d.startHour}, ${d.endHour})`;
    case DISRUPTION.RELEASE_DELAY:
      return `release of ${d.shipmentId} delayed by ${d.delayHours}h`;
    default:
      return d.type;
  }
}

/**
 * Explain why a shipment could not be routed. Called with the reservation table
 * as it stood when the scheduler tried (and failed) to route the shipment.
 *
 * Checked in order, first match wins:
 *  1. invalid_reference       - origin/destination is not a terminal
 *  2. release_beyond_horizon  - effective release is at or after the horizon
 *  3. disconnected            - no path in the bare graph (ignoring time, capacity, disruptions)
 *  4. transit_exceeds_horizon - not even undisrupted, uncongested transit fits before the horizon
 *  5. disruption_blocked      - fits undisrupted, but not with the disruptions applied
 *  6. capacity_exhausted      - fits with disruptions, but other shipments hold the capacity
 */
export function diagnoseFailure(ctx, shipment, reservationsNow) {
  const { terminalIds, adjacency, connections, disruptions, freeProfiles, horizon = HORIZON_HOURS } = ctx;
  const release = effectiveRelease(shipment, disruptions);
  const fail = (code, message, details = {}) => ({ code, message, ...details });

  if (!terminalIds.has(shipment.origin) || !terminalIds.has(shipment.destination)) {
    return fail(
      FAILURE.INVALID_REFERENCE,
      `Origin ${shipment.origin} or destination ${shipment.destination} is not a terminal in this network.`,
    );
  }
  if (shipment.origin === shipment.destination) {
    return fail(FAILURE.INVALID_REFERENCE, 'Origin and destination are the same terminal.');
  }
  if (release >= horizon) {
    const delayed = release > shipment.release;
    return fail(
      FAILURE.RELEASE_BEYOND_HORIZON,
      `Release at hour ${release}${delayed ? ` (originally ${shipment.release}, delayed by disruption)` : ''} is at or after the ${horizon}-hour planning horizon.`,
    );
  }
  if (!isStaticallyConnected(adjacency, shipment.origin, shipment.destination)) {
    return fail(
      FAILURE.DISCONNECTED,
      `No rail path connects ${shipment.origin} to ${shipment.destination} (disconnected network).`,
    );
  }

  const none = emptyReservations(connections, horizon);
  const search = (profiles, start) =>
    findEarliestRoute({
      adjacency,
      profiles,
      reservations: none,
      origin: shipment.origin,
      destination: shipment.destination,
      startTime: start,
      horizon,
    });

  if (!search(freeProfiles, shipment.release)) {
    return fail(
      FAILURE.TRANSIT_EXCEEDS_HORIZON,
      `Even with no disruptions or congestion, released at hour ${shipment.release} the shipment cannot reach ${shipment.destination} before the ${horizon}-hour horizon.`,
    );
  }

  const disruptedProfiles = ctx.disruptedProfiles;
  if (!search(disruptedProfiles, release)) {
    // Single-cause analysis: which disruption, if removed, would make the shipment routable?
    const culprits = [];
    for (const d of disruptions) {
      if (d.type === DISRUPTION.RELEASE_DELAY && d.shipmentId !== shipment.id) continue;
      const rest = disruptions.filter((x) => x !== d);
      const restRelease = effectiveRelease(shipment, rest);
      if (restRelease >= horizon) continue;
      if (search(buildConnectionProfiles(connections, rest, horizon), restRelease)) culprits.push(d);
    }
    const blamed = culprits.length ? culprits : disruptions.filter((d) => d.type !== DISRUPTION.RELEASE_DELAY);
    const verb = culprits.length ? 'Caused by' : 'Caused by the combined effect of';
    return fail(
      FAILURE.DISRUPTION_BLOCKED,
      `Routable without disruptions, but not within the horizon with them. ${verb}: ${blamed.map(describeDisruption).join('; ')}.`,
      { disruptionIds: blamed.map((d) => d.id) },
    );
  }

  const ideal = search(disruptedProfiles, release);
  const exhausted = [];
  for (const leg of ideal.legs) {
    const profile = disruptedProfiles[leg.connectionId];
    const used = reservationsNow[leg.connectionId];
    let free = false;
    for (let d = release; d < horizon; d++) {
      if (profile.capacity[d] - used[d] > 0 && d + profile.travelTime[d] <= horizon) {
        free = true;
        break;
      }
    }
    if (!free) exhausted.push(leg.connectionId);
  }
  const routeText = ideal.legs.map((l) => l.connectionId).join(' > ');
  const message = exhausted.length
    ? `No capacity left before the horizon: ${exhausted.join(', ')} fully reserved by higher-priority shipments (ideal route ${routeText}).`
    : `No conflict-free schedule before the horizon: capacity on the available routes is reserved at the times needed (ideal route ${routeText}).`;
  return fail(FAILURE.CAPACITY_EXHAUSTED, message, { connectionIds: exhausted });
}
