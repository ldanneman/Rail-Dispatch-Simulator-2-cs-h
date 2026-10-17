import { describe, expect, it } from 'vitest';
import { compareShipments, compareMetrics, deriveAlerts, runSchedule, snapshotAt } from '../../src/engine/index.js';
import { listPresets } from '../../src/data/presets.js';
import { getBaseline } from '../../src/state/scenarioModel.js';
import { C, S, closure, net, referenceInput } from './helpers.js';

const preset = (key) => {
  const p = listPresets(getBaseline()).find((x) => x.key === key);
  return { terminals: p.network.terminals, connections: p.network.connections, shipments: p.shipments, disruptions: p.disruptions };
};

describe('metric formulas (hand-computed)', () => {
  it('reference scenario', () => {
    const m = runSchedule(referenceInput()).metrics;
    expect(m.totals).toEqual({ shipments: 3, onTime: 3, late: 0, undeliverable: 0, delivered: 3 });
    expect(m.onTimePct).toBe(100);
    expect(m.avgLateness).toBe(0);
    expect(m.avgTransit).toBe(3); // (2 + 3 + 4) / 3 hours from release
    expect(m.avgWait).toBe(1); // (0 + 1 + 2) / 3
    // operating window = first..last departure slot = [8, 11]; each connection offers 4 slots x capacity 1
    expect(m.operatingWindow).toEqual({ start: 8, end: 11 });
    expect(m.totalMovements).toBe(6);
    expect(m.utilization).toBe(6 / 8);
    expect(m.horizonUtilization).toBe(6 / 336);
    const ab = m.connections.find((c) => c.id === 'AB');
    expect(ab).toMatchObject({ movements: 3, windowCapacity: 4, utilization: 0.75, peakLoad: 1, saturatedSlots: 3, queuedHours: 3, delayedMovements: 2, closedSlots: 0 });
    const bc = m.connections.find((c) => c.id === 'BC');
    expect(bc).toMatchObject({ movements: 3, queuedHours: 0, delayedMovements: 0, saturatedSlots: 3 });
  });

  it('terminal throughput counts arrivals and departures, not percentages', () => {
    const t = Object.fromEntries(runSchedule(referenceInput()).metrics.terminals.map((x) => [x.id, x]));
    expect(t.A).toMatchObject({ departures: 3, arrivals: 0, originated: 3, delivered: 0, transfers: 0 });
    expect(t.B).toMatchObject({ departures: 3, arrivals: 3, transfers: 3 });
    expect(t.C).toMatchObject({ departures: 0, arrivals: 3, delivered: 3, transfers: 0 });
  });

  it('late shipments: average delay includes on-time zeros; late-only average does not', () => {
    const m = runSchedule(preset('capacity-bottleneck')).metrics; // lateness 0,0,0,0,1,2
    expect(m.totals).toMatchObject({ onTime: 4, late: 2, undeliverable: 0 });
    expect(m.onTimePct).toBeCloseTo(66.6667, 3);
    expect(m.avgLateness).toBe(0.5);
    expect(m.avgLatenessLateOnly).toBe(1.5);
    expect(m.maxLateness).toBe(2);
    expect(m.totalLateness).toBe(3);
  });

  it('undeliverable shipments count against on-time % but are excluded from delay averages', () => {
    const m = runSchedule(preset('disconnected-network')).metrics;
    expect(m.totals).toMatchObject({ onTime: 2, undeliverable: 2, delivered: 2 });
    expect(m.onTimePct).toBe(50); // 2 of ALL 4
    expect(m.onTimeOfDeliveredPct).toBe(100);
    expect(m.undeliverablePct).toBe(50);
    expect(m.avgLateness).toBe(0);
    expect(m.avgTransit).toBe(2); // (2 + 2) / 2 delivered only
  });

  it('priority breakdown adds up', () => {
    const m = runSchedule(preset('conflicting-deadlines')).metrics;
    expect(m.byPriority[4]).toEqual({ total: 1, onTime: 1, late: 0, undeliverable: 0 });
    expect(m.byPriority[2]).toEqual({ total: 2, onTime: 0, late: 2, undeliverable: 0 });
    expect(m.byPriority[1]).toEqual({ total: 1, onTime: 0, late: 1, undeliverable: 0 });
  });

  it('closures reduce the capacity denominator', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 2)], [S('S1', 'A', 'B', 10, 40), S('S2', 'A', 'B', 13, 40)], [closure('D1', 'AB', 11, 13)]);
    const ab = runSchedule(input).metrics.connections[0];
    // departures 10 and 13; window [10, 13]: slots 10,13 open (cap 2 each); 11 and 12 closed
    expect(ab.windowCapacity).toBe(4);
    expect(ab.closedSlots).toBeGreaterThanOrEqual(2);
    expect(ab.utilization).toBe(0.5);
  });

  it('an empty schedule yields null ratios and zero utilization, never NaN', () => {
    const m = runSchedule(net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [])).metrics;
    expect(m.onTimePct).toBeNull();
    expect(m.avgLateness).toBeNull();
    expect(m.utilization).toBe(0);
    expect(JSON.stringify(m)).not.toMatch(/NaN|Infinity/);
  });
});

describe('alerts', () => {
  it('reports undeliverable shipments with their reason, late deliveries and bottlenecks', () => {
    const input = preset('disconnected-network');
    const alerts = deriveAlerts(input, runSchedule(input));
    const und = alerts.find((a) => a.kind === 'undeliverable');
    expect(und.severity).toBe('critical');
    expect(und.shipmentIds).toEqual(['S3', 'S4']);
    expect(und.detail).toMatch(/disconnected/);

    const b = preset('capacity-bottleneck');
    const ba = deriveAlerts(b, runSchedule(b));
    expect(ba.find((a) => a.kind === 'late').shipmentIds).toEqual(['S5', 'S6']);
    const bn = ba.find((a) => a.kind === 'bottleneck');
    expect(bn.connectionIds).toEqual(['AB']);
    expect(bn.detail).toMatch(/queued/);
  });

  it('lists active disruptions and sorts critical alerts first', () => {
    const input = preset('connection-closure');
    const alerts = deriveAlerts(input, runSchedule(input));
    expect(alerts.some((a) => a.kind === 'disruption' && /closure of AB/.test(a.detail))).toBe(true);
    const severities = alerts.map((a) => a.severity);
    expect(severities).toEqual([...severities].sort((x, y) => ['critical', 'warning', 'info'].indexOf(x) - ['critical', 'warning', 'info'].indexOf(y)));
  });

  it('is quiet when everything is fine', () => {
    const input = preset('reference-three-terminal');
    const alerts = deriveAlerts(input, runSchedule(input));
    expect(alerts.filter((a) => a.severity === 'critical')).toEqual([]);
  });
});

describe('comparison', () => {
  it('flags rerouted, newly late, newly undeliverable, recovered and release-delayed shipments', () => {
    // D is only reachable through AD. Closing AB forces A->C and A->B onto the slow 5h AC link.
    const base = net(
      ['A', 'B', 'C', 'D'],
      [C('AB', 'A', 'B', 1, 3), C('BC', 'B', 'C', 1, 3), C('AC', 'A', 'C', 5, 3), C('AD', 'A', 'D', 1, 3)],
      [S('S1', 'A', 'C', 0, 3), S('S2', 'A', 'D', 0, 40), S('S3', 'A', 'C', 0, 40), S('S4', 'A', 'B', 0, 40)],
    );
    const a = runSchedule(base);
    const b = runSchedule({
      ...base,
      disruptions: [
        { id: 'D1', type: 'closure', connectionId: 'AB', startHour: 0, endHour: 400 },
        { id: 'D2', type: 'closure', connectionId: 'AD', startHour: 0, endHour: 400 },
        { id: 'D3', type: 'release_delay', shipmentId: 'S3', delayHours: 4 },
      ],
    });
    const diff = compareShipments(a, b);
    const row = (id) => diff.rows.find((r) => r.id === id);
    expect(row('S1').flags).toEqual(['rerouted', 'newly_late']); // AB>BC arrives 2 -> AC arrives 5 (deadline 3)
    expect(row('S1').b.routeKey).toBe('AC');
    expect(row('S2').flags).toEqual(['newly_undeliverable']);
    expect(row('S2').b.failure.message).toMatch(/closure of AD/);
    expect(row('S3').flags).toEqual(['rerouted', 'release_delayed']); // delayed to 4: AC@4 arrives 9
    expect(row('S3').arrivalDelta).toBe(9 - 2);
    expect(row('S4').flags).toEqual(['rerouted']); // AB arrives 1 -> AC@0, BC@5 arrives 6
    expect(row('S4').arrivalDelta).toBe(5);
    expect(diff.summary).toMatchObject({ rerouted: 3, newlyUndeliverable: 1, newlyLate: 1, releaseDelayed: 1, recovered: 0, affected: 4, total: 4 });

    expect(compareShipments(b, a).summary.recovered).toBe(1);
    const metrics = Object.fromEntries(compareMetrics(a, b, diff).map((m) => [m.key, m]));
    expect(metrics.undeliverable).toMatchObject({ a: 0, b: 1, delta: 1 });
    expect(metrics.rerouted.b).toBe(3);
    expect(metrics.onTimePct).toMatchObject({ a: 100, b: 50, delta: -50 });
  });

  it('classifies a shipment that keeps its route but moves in time as retimed', () => {
    const base = net(['A', 'B'], [C('AB', 'A', 'B', 2, 1)], [S('S1', 'A', 'B', 0, 40)]);
    const a = runSchedule(base);
    const b = runSchedule({ ...base, disruptions: [{ id: 'D1', type: 'travel_time', connectionId: 'AB', startHour: 0, endHour: 10, extraHours: 3 }] });
    const row = compareShipments(a, b).rows[0];
    expect(row.flags).toEqual(['retimed']);
    expect(row.arrivalDelta).toBe(3);
  });

  it('reports shipments that exist on only one side as added / removed', () => {
    const a = runSchedule(net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 9)]));
    const b = runSchedule(net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S2', 'A', 'B', 0, 9)]));
    const d = compareShipments(a, b);
    expect(d.rows.map((r) => [r.id, r.flags[0]])).toEqual([['S1', 'removed'], ['S2', 'added']]);
  });

  it('identical results are unaffected', () => {
    const r = runSchedule(referenceInput());
    expect(compareShipments(r, runSchedule(referenceInput())).summary.affected).toBe(0);
  });
});

describe('playback snapshot', () => {
  const result = runSchedule(referenceInput());
  it('follows the half-open convention at hour boundaries', () => {
    expect(snapshotAt(result, 7).counts).toEqual({ notReleased: 3, waiting: 0, inTransit: 0, delivered: 0, undeliverable: 0 });
    const t8 = snapshotAt(result, 8);
    expect(t8.counts).toMatchObject({ notReleased: 0, inTransit: 1, waiting: 2 });
    expect(t8.waiting).toEqual({ A: 2 });
    expect(t8.movements[0]).toMatchObject({ connectionId: 'AB', from: 'A', to: 'B', progress: 0 });
    const t9 = snapshotAt(result, 9);
    expect(t9.counts).toMatchObject({ inTransit: 2, waiting: 1 });
    expect(snapshotAt(result, 10).counts.delivered).toBe(1); // S1 arrives exactly at 10 -> delivered at t=10
    expect(snapshotAt(result, 12).counts).toMatchObject({ delivered: 3, inTransit: 0, waiting: 0 });
  });

  it('counts undeliverable shipments and tracks shipments waiting at a transfer terminal', () => {
    const input = net(['A', 'B', 'C'], [C('AB', 'A', 'B', 1, 5), C('BC', 'B', 'C', 1, 1)], [S('S1', 'A', 'C', 0, 20), S('S2', 'A', 'C', 0, 20), S('S3', 'A', 'X', 0, 20)]);
    const r = runSchedule(input);
    const snap = snapshotAt(r, 1); // S2 has arrived at B but BC is taken in slot 1 by S1
    expect(snap.counts.undeliverable).toBe(1);
    expect(snap.waiting.B).toBe(1);
  });
});
