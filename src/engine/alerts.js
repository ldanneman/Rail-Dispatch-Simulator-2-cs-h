import { FAILURE, LATE_CAUSE, PRIORITY_LABEL, STATUS } from './constants.js';
import { describeDisruption } from './diagnose.js';
import { compareIds } from './ids.js';

export const LONG_WAIT_HOURS = 12;

const FAILURE_TITLE = {
  [FAILURE.INVALID_REFERENCE]: 'unknown origin or destination',
  [FAILURE.RELEASE_BEYOND_HORIZON]: 'released at or after the planning horizon',
  [FAILURE.DISCONNECTED]: 'no rail path between origin and destination',
  [FAILURE.TRANSIT_EXCEEDS_HORIZON]: 'transit does not fit before the horizon',
  [FAILURE.DISRUPTION_BLOCKED]: 'blocked by disruptions',
  [FAILURE.CAPACITY_EXHAUSTED]: 'connection capacity exhausted',
};

/**
 * Operational alerts derived only from the schedule result.
 * severity: critical | warning | info
 */
export function deriveAlerts(input, result) {
  const alerts = [];
  const ships = result.shipments;

  // Undeliverable, grouped by cause.
  const byCode = new Map();
  for (const s of ships) {
    if (s.status !== STATUS.UNDELIVERABLE) continue;
    const code = s.failure?.code ?? 'unknown';
    if (!byCode.has(code)) byCode.set(code, []);
    byCode.get(code).push(s);
  }
  for (const [code, list] of byCode) {
    alerts.push({
      id: `undeliverable:${code}`,
      severity: 'critical',
      kind: 'undeliverable',
      title: `${list.length} undeliverable: ${FAILURE_TITLE[code] ?? code}`,
      detail: list[0].failure?.message ?? '',
      shipmentIds: list.map((s) => s.id),
      connectionIds: [],
    });
  }

  // Late deliveries.
  const late = ships.filter((s) => s.status === STATUS.LATE);
  if (late.length) {
    const urgent = late.filter((s) => s.priority >= 3);
    const causes = { [LATE_CAUSE.CONGESTION]: 0, [LATE_CAUSE.DISRUPTION]: 0, [LATE_CAUSE.DEADLINE_INFEASIBLE]: 0 };
    for (const s of late) causes[s.lateCause] += 1;
    alerts.push({
      id: 'late',
      severity: urgent.length ? 'critical' : 'warning',
      kind: 'late',
      title: `${late.length} late deliver${late.length === 1 ? 'y' : 'ies'}${urgent.length ? ` (${urgent.length} ${PRIORITY_LABEL[4].toLowerCase()}/${PRIORITY_LABEL[3].toLowerCase()} priority)` : ''}`,
      detail: `Causes: ${causes[LATE_CAUSE.CONGESTION]} congestion, ${causes[LATE_CAUSE.DISRUPTION]} disruption, ${causes[LATE_CAUSE.DEADLINE_INFEASIBLE]} deadline shorter than minimum transit.`,
      shipmentIds: late.map((s) => s.id),
      connectionIds: [],
    });
  }

  // Capacity bottlenecks: saturated connections where shipments actually queued.
  const bottlenecks = result.metrics.connections
    .filter((c) => c.saturatedSlots > 0 && c.delayedMovements > 0)
    .sort((x, y) => y.queuedHours - x.queuedHours || compareIds(x.id, y.id));
  for (const c of bottlenecks) {
    alerts.push({
      id: `bottleneck:${c.id}`,
      severity: c.queuedHours >= 24 ? 'critical' : 'warning',
      kind: 'bottleneck',
      title: `Bottleneck on ${c.id} (${c.from}–${c.to})`,
      detail: `Full in ${c.saturatedSlots} hourly slot${c.saturatedSlots === 1 ? '' : 's'}; ${c.delayedMovements} movement${c.delayedMovements === 1 ? '' : 's'} queued for ${c.queuedHours} shipment-hours in total.`,
      shipmentIds: ships.filter((s) => s.legs.some((l) => l.connectionId === c.id && l.waitBefore > 0)).map((s) => s.id),
      connectionIds: [c.id],
    });
  }

  // Active disruptions.
  for (const d of input.disruptions ?? []) {
    alerts.push({
      id: `disruption:${d.id}`,
      severity: 'info',
      kind: 'disruption',
      title: `Disruption ${d.id}`,
      detail: describeDisruption(d),
      shipmentIds: d.shipmentId ? [d.shipmentId] : [],
      connectionIds: d.connectionId ? [d.connectionId] : [],
    });
  }

  // Deadlines that cannot be met even with an empty, undisrupted network.
  const infeasible = ships.filter((s) => s.minArrival !== null && s.minArrival > s.deadline);
  if (infeasible.length) {
    alerts.push({
      id: 'deadline-infeasible',
      severity: 'warning',
      kind: 'deadline',
      title: `${infeasible.length} deadline${infeasible.length === 1 ? '' : 's'} shorter than the minimum possible transit`,
      detail: 'These shipments are late by definition, regardless of congestion or disruptions.',
      shipmentIds: infeasible.map((s) => s.id),
      connectionIds: [],
    });
  }

  // Long waits.
  const longWait = ships.filter((s) => s.waitHours !== null && s.waitHours >= LONG_WAIT_HOURS);
  if (longWait.length) {
    alerts.push({
      id: 'long-wait',
      severity: 'warning',
      kind: 'wait',
      title: `${longWait.length} shipment${longWait.length === 1 ? '' : 's'} waited ${LONG_WAIT_HOURS}h or more`,
      detail: `Longest wait: ${Math.max(...longWait.map((s) => s.waitHours))}h.`,
      shipmentIds: longWait.map((s) => s.id),
      connectionIds: [],
    });
  }

  const rank = { critical: 0, warning: 1, info: 2 };
  return alerts.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
