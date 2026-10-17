import { STATUS } from './constants.js';

const ratio = (num, den) => (den > 0 ? num / den : null);

/**
 * All dashboard numbers come from here, derived purely from a schedule result.
 * Formulas are documented in the Obsidian note "Metrics and Formulas" and in the
 * in-app Assumptions page.
 *
 *  onTimePct          = on_time / all shipments * 100          (undeliverable count as NOT on time)
 *  avgLateness        = sum(lateness) / delivered              (on-time deliveries contribute 0)
 *  avgLatenessLateOnly= sum(lateness) / late
 *  utilization(conn)  = movements / sum(capacity[d]) for d in the operating window
 *  operating window   = [first departure slot, last departure slot] over the whole schedule
 *  horizonUtilization = movements / sum(capacity[d]) for d in [0, horizon)
 *  Undeliverable shipments are excluded from lateness / transit / wait averages
 *  and reported separately.
 */
export function computeMetrics(input, result) {
  const { terminals, connections } = input;
  const ships = result.shipments;
  const total = ships.length;

  const totals = { shipments: total, onTime: 0, late: 0, undeliverable: 0, delivered: 0 };
  let sumLateness = 0;
  let maxLateness = 0;
  let sumTransit = 0;
  let sumWait = 0;
  const byPriority = {};
  for (const p of [4, 3, 2, 1]) byPriority[p] = { total: 0, onTime: 0, late: 0, undeliverable: 0 };

  let firstSlot = Infinity;
  let lastSlot = -Infinity;
  const connLegs = new Map(connections.map((c) => [c.id, { delayed: 0, queued: 0 }]));
  const term = new Map(
    terminals.map((t) => [t.id, { id: t.id, name: t.name, departures: 0, arrivals: 0, originated: 0, delivered: 0 }]),
  );

  for (const s of ships) {
    const bucket = byPriority[s.priority] ?? (byPriority[s.priority] = { total: 0, onTime: 0, late: 0, undeliverable: 0 });
    bucket.total += 1;
    if (s.status === STATUS.UNDELIVERABLE) {
      totals.undeliverable += 1;
      bucket.undeliverable += 1;
      continue;
    }
    totals.delivered += 1;
    if (s.status === STATUS.ON_TIME) {
      totals.onTime += 1;
      bucket.onTime += 1;
    } else {
      totals.late += 1;
      bucket.late += 1;
    }
    sumLateness += s.lateness;
    maxLateness = Math.max(maxLateness, s.lateness);
    sumTransit += s.transitHours;
    sumWait += s.waitHours;
    if (term.has(s.origin)) term.get(s.origin).originated += 1;
    if (term.has(s.destination)) term.get(s.destination).delivered += 1;
    for (const leg of s.legs) {
      firstSlot = Math.min(firstSlot, leg.depart);
      lastSlot = Math.max(lastSlot, leg.depart);
      if (term.has(leg.from)) term.get(leg.from).departures += 1;
      if (term.has(leg.to)) term.get(leg.to).arrivals += 1;
      const cl = connLegs.get(leg.connectionId);
      if (cl) {
        if (leg.waitBefore > 0) cl.delayed += 1;
        cl.queued += leg.waitBefore;
      }
    }
  }

  const operatingWindow = firstSlot === Infinity ? null : { start: firstSlot, end: lastSlot };
  const horizon = result.horizon;

  let totalMovements = 0;
  let totalWindowCapacity = 0;
  let totalHorizonCapacity = 0;
  const connectionStats = connections.map((c) => {
    const used = result.reservations[c.id];
    const profile = result.profiles[c.id];
    let movements = 0;
    let windowCapacity = 0;
    let horizonCapacity = 0;
    let peakLoad = 0;
    let saturatedSlots = 0;
    let closedSlots = 0;
    for (let d = 0; d < horizon; d++) {
      movements += used[d];
      horizonCapacity += profile.capacity[d];
      if (operatingWindow && d >= operatingWindow.start && d <= operatingWindow.end) {
        windowCapacity += profile.capacity[d];
      }
      if (profile.closed[d]) closedSlots += 1;
      if (profile.capacity[d] > 0) {
        peakLoad = Math.max(peakLoad, used[d] / profile.capacity[d]);
        if (used[d] === profile.capacity[d]) saturatedSlots += 1;
      }
    }
    totalMovements += movements;
    totalWindowCapacity += windowCapacity;
    totalHorizonCapacity += horizonCapacity;
    const cl = connLegs.get(c.id);
    return {
      id: c.id,
      from: c.from,
      to: c.to,
      baseCapacity: c.capacity,
      movements,
      windowCapacity,
      utilization: windowCapacity > 0 ? movements / windowCapacity : 0,
      horizonUtilization: horizonCapacity > 0 ? movements / horizonCapacity : 0,
      peakLoad,
      saturatedSlots,
      closedSlots,
      delayedMovements: cl.delayed,
      queuedHours: cl.queued,
    };
  });

  const terminalStats = [...term.values()].map((t) => ({ ...t, transfers: t.arrivals - t.delivered }));

  return {
    totals,
    onTimePct: ratio(totals.onTime, total) === null ? null : (totals.onTime / total) * 100,
    onTimeOfDeliveredPct: ratio(totals.onTime, totals.delivered) === null ? null : (totals.onTime / totals.delivered) * 100,
    latePct: ratio(totals.late, total) === null ? null : (totals.late / total) * 100,
    undeliverablePct: ratio(totals.undeliverable, total) === null ? null : (totals.undeliverable / total) * 100,
    avgLateness: ratio(sumLateness, totals.delivered),
    avgLatenessLateOnly: ratio(sumLateness, totals.late),
    maxLateness,
    totalLateness: sumLateness,
    avgTransit: ratio(sumTransit, totals.delivered),
    avgWait: ratio(sumWait, totals.delivered),
    operatingWindow,
    totalMovements,
    utilization: totalWindowCapacity > 0 ? totalMovements / totalWindowCapacity : 0,
    horizonUtilization: totalHorizonCapacity > 0 ? totalMovements / totalHorizonCapacity : 0,
    connections: connectionStats,
    terminals: terminalStats,
    byPriority,
  };
}
