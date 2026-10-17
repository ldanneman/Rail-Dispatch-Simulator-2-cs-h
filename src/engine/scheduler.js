import {
  HORIZON_HOURS,
  LATE_CAUSE,
  MAX_REFINEMENT_PASSES,
  PRIORITY_WEIGHT,
  STATUS,
} from './constants.js';
import { compareIds } from './ids.js';
import { buildAdjacency } from './network.js';
import { buildConnectionProfiles, effectiveRelease, emptyReservations } from './profile.js';
import { findEarliestRoute } from './search.js';
import { diagnoseFailure } from './diagnose.js';
import { computeMetrics } from './metrics.js';

const byId = (a, b) => compareIds(a.id, b.id);

function assertUnique(list, kind) {
  const seen = new Set();
  for (const item of list) {
    if (seen.has(item.id)) throw new RangeError(`Duplicate ${kind} id: ${item.id}`);
    seen.add(item.id);
  }
}

/**
 * Schedule every shipment. Pure and deterministic: the same input always yields
 * the same output, independent of the order of the input arrays.
 *
 * input: { terminals, connections, shipments, disruptions }
 * options.refinementPasses: override MAX_REFINEMENT_PASSES (0 disables refinement)
 */
export function runSchedule(input, options = {}) {
  const horizon = HORIZON_HOURS;
  const maxPasses = options.refinementPasses ?? MAX_REFINEMENT_PASSES;
  const terminals = [...input.terminals].sort(byId);
  const connections = [...input.connections].sort(byId);
  const shipments = [...input.shipments].sort(byId);
  const disruptions = [...(input.disruptions ?? [])].sort(byId);
  assertUnique(terminals, 'terminal');
  assertUnique(connections, 'connection');
  assertUnique(shipments, 'shipment');
  assertUnique(disruptions, 'disruption');

  const adjacency = buildAdjacency(terminals, connections);
  const freeProfiles = buildConnectionProfiles(connections, [], horizon);
  const disruptedProfiles = buildConnectionProfiles(connections, disruptions, horizon);
  const ctx = {
    terminalIds: new Set(terminals.map((t) => t.id)),
    adjacency,
    connections,
    disruptions,
    freeProfiles,
    disruptedProfiles,
    horizon,
  };

  const route = (reservations, profiles, s, start) =>
    findEarliestRoute({
      adjacency,
      profiles,
      reservations,
      origin: s.origin,
      destination: s.destination,
      startTime: start,
      horizon,
    });

  // Per-shipment reference arrivals (no congestion).
  const noReservations = emptyReservations(connections, horizon);
  const info = new Map();
  for (const s of shipments) {
    const effRelease = effectiveRelease(s, disruptions);
    const free = route(noReservations, freeProfiles, s, s.release);
    const floor = effRelease < horizon ? route(noReservations, disruptedProfiles, s, effRelease) : null;
    info.set(s.id, {
      effRelease,
      minArrival: free ? free.arrival : null,
      floorArrival: floor ? floor.arrival : null,
    });
  }

  // Initial order: priority desc, slack asc, deadline asc, effective release asc, id.
  const slackOf = (s) => {
    const f = info.get(s.id).floorArrival;
    return f === null ? Infinity : s.deadline - f;
  };
  const initialOrder = [...shipments].sort(
    (a, b) =>
      b.priority - a.priority ||
      cmpNum(slackOf(a), slackOf(b)) ||
      a.deadline - b.deadline ||
      info.get(a.id).effRelease - info.get(b.id).effRelease ||
      compareIds(a.id, b.id),
  );

  const runPass = (order, diagnose) => {
    const reservations = emptyReservations(connections, horizon);
    const outcomes = new Map();
    for (const s of order) {
      const { effRelease } = info.get(s.id);
      const found = effRelease < horizon ? route(reservations, disruptedProfiles, s, effRelease) : null;
      if (found) {
        for (const leg of found.legs) reservations[leg.connectionId][leg.depart] += 1;
        outcomes.set(s.id, { legs: found.legs, failure: null });
      } else {
        const failure = diagnose ? diagnoseFailure(ctx, s, reservations) : { code: 'unrouted', message: '' };
        outcomes.set(s.id, { legs: [], failure });
      }
    }
    return { reservations, outcomes };
  };

  const objectiveOf = (outcomes) => {
    let undeliverable = 0;
    let lateCount = 0;
    let lateHours = 0;
    for (const s of shipments) {
      const o = outcomes.get(s.id);
      const w = PRIORITY_WEIGHT[s.priority] ?? 1;
      if (o.legs.length === 0) undeliverable += w;
      else {
        const late = o.legs[o.legs.length - 1].arrive - s.deadline;
        if (late > 0) {
          lateCount += w;
          lateHours += w * late;
        }
      }
    }
    return [undeliverable, lateCount, lateHours];
  };
  const better = (a, b) => {
    for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] < b[i];
    return false;
  };

  // Pass 1 + bounded refinement: promote late/unrouted shipments to the front of their
  // priority class and keep the best pass. A pass is only adopted if it is strictly better.
  let order = initialOrder;
  let bestOrder = order;
  let pass = runPass(order, false);
  let bestObjective = objectiveOf(pass.outcomes);
  const seenOrders = new Set([order.map((s) => s.id).join('|')]);
  let passesUsed = 1;
  for (let i = 0; i < maxPasses; i++) {
    const failing = new Set();
    for (const s of shipments) {
      const o = pass.outcomes.get(s.id);
      if (o.legs.length === 0 || o.legs[o.legs.length - 1].arrive > s.deadline) failing.add(s.id);
    }
    if (failing.size === 0) break;
    const promoted = order
      .map((s, idx) => ({ s, idx }))
      .sort(
        (a, b) =>
          b.s.priority - a.s.priority ||
          Number(failing.has(b.s.id)) - Number(failing.has(a.s.id)) ||
          a.idx - b.idx,
      )
      .map((x) => x.s);
    const signature = promoted.map((s) => s.id).join('|');
    if (seenOrders.has(signature)) break;
    seenOrders.add(signature);
    order = promoted;
    pass = runPass(order, false);
    passesUsed += 1;
    const objective = objectiveOf(pass.outcomes);
    if (better(objective, bestObjective)) {
      bestObjective = objective;
      bestOrder = order;
    }
  }

  // Replay the winning order once with diagnostics enabled.
  const final = runPass(bestOrder, true);

  const results = shipments.map((s) => {
    const meta = info.get(s.id);
    const outcome = final.outcomes.get(s.id);
    return buildShipmentResult(s, meta, outcome);
  });

  const result = {
    horizon,
    order: bestOrder.map((s) => s.id),
    passesUsed,
    objective: bestObjective,
    shipments: results,
    reservations: final.reservations,
    profiles: disruptedProfiles,
  };
  result.metrics = computeMetrics({ terminals, connections, shipments, disruptions }, result);
  return result;
}

function cmpNum(a, b) {
  if (a === b) return 0;
  return a < b ? -1 : 1;
}

function buildShipmentResult(s, meta, outcome) {
  const base = {
    id: s.id,
    origin: s.origin,
    destination: s.destination,
    priority: s.priority,
    release: s.release,
    effectiveRelease: meta.effRelease,
    deadline: s.deadline,
    minArrival: meta.minArrival,
    floorArrival: meta.floorArrival,
  };
  if (outcome.legs.length === 0) {
    return {
      ...base,
      status: STATUS.UNDELIVERABLE,
      legs: [],
      departure: null,
      arrival: null,
      lateness: null,
      transitHours: null,
      waitHours: null,
      routeKey: '',
      lateCause: null,
      failure: outcome.failure,
    };
  }
  let prevReady = meta.effRelease;
  let waitHours = 0;
  const legs = outcome.legs.map((leg, index) => {
    const waitBefore = leg.depart - prevReady;
    prevReady = leg.arrive;
    waitHours += waitBefore;
    return { index, ...leg, waitBefore };
  });
  const arrival = legs[legs.length - 1].arrive;
  const lateness = Math.max(0, arrival - s.deadline);
  const status = lateness > 0 ? STATUS.LATE : STATUS.ON_TIME;
  let lateCause = null;
  if (status === STATUS.LATE) {
    if (meta.minArrival === null || meta.minArrival > s.deadline) lateCause = LATE_CAUSE.DEADLINE_INFEASIBLE;
    else if (meta.floorArrival === null || meta.floorArrival > s.deadline) lateCause = LATE_CAUSE.DISRUPTION;
    else lateCause = LATE_CAUSE.CONGESTION;
  }
  return {
    ...base,
    status,
    legs,
    departure: legs[0].depart,
    arrival,
    lateness,
    transitHours: arrival - meta.effRelease,
    waitHours,
    routeKey: legs.map((l) => l.connectionId).join('>'),
    lateCause,
    failure: null,
  };
}

