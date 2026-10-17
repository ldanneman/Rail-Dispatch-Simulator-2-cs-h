import { STATUS } from './constants.js';
import { compareIds } from './ids.js';

const sameTimes = (a, b) =>
  a.legs.length === b.legs.length &&
  a.legs.every((l, i) => l.connectionId === b.legs[i].connectionId && l.depart === b.legs[i].depart && l.arrive === b.legs[i].arrive);

/**
 * Per-shipment differences between two schedule results, matched by shipment id.
 *
 * Flags (a row can have several):
 *  rerouted             both routed, different connection sequence
 *  retimed              both routed, same connections, different departure/arrival times
 *  newly_late           on time in A, late in B
 *  newly_undeliverable  routed in A, undeliverable in B
 *  recovered            undeliverable in A, routed in B
 *  release_delayed      effective release later in B
 *  added / removed      shipment exists only in B / only in A
 * "Affected" = any flag set.
 */
export function compareShipments(resultA, resultB) {
  const a = new Map(resultA.shipments.map((s) => [s.id, s]));
  const b = new Map(resultB.shipments.map((s) => [s.id, s]));
  const ids = [...new Set([...a.keys(), ...b.keys()])].sort(compareIds);

  const rows = ids.map((id) => {
    const sa = a.get(id) ?? null;
    const sb = b.get(id) ?? null;
    const flags = [];
    if (!sa) flags.push('added');
    else if (!sb) flags.push('removed');
    else {
      const routedA = sa.status !== STATUS.UNDELIVERABLE;
      const routedB = sb.status !== STATUS.UNDELIVERABLE;
      if (routedA && routedB) {
        if (sa.routeKey !== sb.routeKey) flags.push('rerouted');
        else if (!sameTimes(sa, sb)) flags.push('retimed');
      }
      if (sa.status === STATUS.ON_TIME && sb.status === STATUS.LATE) flags.push('newly_late');
      if (routedA && !routedB) flags.push('newly_undeliverable');
      if (!routedA && routedB) flags.push('recovered');
      if (sb.effectiveRelease > sa.effectiveRelease) flags.push('release_delayed');
    }
    const arrivalDelta = sa && sb && sa.arrival !== null && sb.arrival !== null ? sb.arrival - sa.arrival : null;
    return { id, flags, affected: flags.length > 0, a: sa, b: sb, arrivalDelta };
  });

  const count = (flag) => rows.filter((r) => r.flags.includes(flag)).length;
  const summary = {
    total: rows.length,
    affected: rows.filter((r) => r.affected).length,
    unchanged: rows.filter((r) => !r.affected).length,
    rerouted: count('rerouted'),
    retimed: count('retimed'),
    newlyLate: count('newly_late'),
    newlyUndeliverable: count('newly_undeliverable'),
    recovered: count('recovered'),
    releaseDelayed: count('release_delayed'),
    added: count('added'),
    removed: count('removed'),
  };
  return { rows, summary };
}

/** Metric table rows for scenario comparison: value in A, value in B, delta (B - A). */
export function compareMetrics(resultA, resultB, shipmentDiff) {
  const ma = resultA.metrics;
  const mb = resultB.metrics;
  const row = (key, label, a, b, unit, betterWhen) => ({
    key,
    label,
    a,
    b,
    unit,
    betterWhen, // 'higher' | 'lower' | null
    delta: a === null || b === null ? null : b - a,
  });
  return [
    row('onTimePct', 'On-time delivery', ma.onTimePct, mb.onTimePct, '%', 'higher'),
    row('avgLateness', 'Average delivery delay (delivered)', ma.avgLateness, mb.avgLateness, 'h', 'lower'),
    row('late', 'Late shipments', ma.totals.late, mb.totals.late, '', 'lower'),
    row('undeliverable', 'Undeliverable shipments', ma.totals.undeliverable, mb.totals.undeliverable, '', 'lower'),
    row('rerouted', 'Rerouted shipments', 0, shipmentDiff.summary.rerouted, '', null),
    row('utilization', 'Capacity utilization (operating window)', pct(ma.utilization), pct(mb.utilization), '%', null),
    row('horizonUtilization', 'Capacity utilization (7-day horizon)', pct(ma.horizonUtilization), pct(mb.horizonUtilization), '%', null),
    row('movements', 'Total movements', ma.totalMovements, mb.totalMovements, '', null),
    row('avgTransit', 'Average transit time (delivered)', ma.avgTransit, mb.avgTransit, 'h', 'lower'),
  ];
}

const pct = (x) => (x === null ? null : x * 100);
