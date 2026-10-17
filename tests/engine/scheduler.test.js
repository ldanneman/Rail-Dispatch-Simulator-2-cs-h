import { describe, expect, it } from 'vitest';
import { runSchedule, verifySchedule, FAILURE, HORIZON_HOURS, STATUS } from '../../src/engine/index.js';
import { C, S, byId, closure, cut, delay, net, referenceInput, slow } from './helpers.js';

const run = (input, options) => {
  const result = runSchedule(input, options);
  const check = verifySchedule(input, result);
  expect(check.violations).toEqual([]); // every schedule in this file must pass the independent checker
  return result;
};

describe('reference scenario (A-B-C, 1h travel, capacity 1)', () => {
  it('delivers the three shipments at hours 10, 11 and 12 without violating capacity', () => {
    const result = run(referenceInput());
    const s = byId(result);
    expect([s.S1.arrival, s.S2.arrival, s.S3.arrival]).toEqual([10, 11, 12]);
    expect(s.S1.legs.map((l) => [l.connectionId, l.depart, l.arrive])).toEqual([['AB', 8, 9], ['BC', 9, 10]]);
    expect(s.S2.legs.map((l) => [l.connectionId, l.depart, l.arrive])).toEqual([['AB', 9, 10], ['BC', 10, 11]]);
    expect(s.S3.legs.map((l) => [l.connectionId, l.depart, l.arrive])).toEqual([['AB', 10, 11], ['BC', 11, 12]]);
    for (const conn of ['AB', 'BC']) expect(Math.max(...result.reservations[conn])).toBeLessThanOrEqual(1);
    expect(result.metrics.totals).toMatchObject({ onTime: 3, late: 0, undeliverable: 0 });
  });
});

describe('release times and multi-leg arrival arithmetic', () => {
  it('never departs before the release time, even when the network is idle', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 3, 5)], [S('S1', 'A', 'B', 17, 30)]);
    const s = byId(run(input)).S1;
    expect(s.departure).toBe(17);
    expect(s.arrival).toBe(20);
  });

  it('adds travel times across several connections and reports waiting separately', () => {
    // A-B 2h, B-C 3h, C-D 4h. Released at 5: 5+2=7, 7+3=10, 10+4=14.
    const input = net(
      ['A', 'B', 'C', 'D'],
      [C('AB', 'A', 'B', 2, 1), C('BC', 'B', 'C', 3, 1), C('CD', 'C', 'D', 4, 1)],
      [S('S1', 'A', 'D', 5, 14), S('S2', 'A', 'D', 5, 14)],
    );
    const s = byId(run(input));
    expect(s.S1.legs.map((l) => [l.depart, l.arrive, l.waitBefore])).toEqual([[5, 7, 0], [7, 10, 0], [10, 14, 0]]);
    expect(s.S1.arrival).toBe(14);
    expect(s.S1.status).toBe(STATUS.ON_TIME); // arrival == deadline is on time
    // S2 trails S1 by one hour on every connection: it waits 1h at the origin, then pipelines with no further waiting.
    expect(s.S2.legs.map((l) => [l.depart, l.arrive, l.waitBefore])).toEqual([[6, 8, 1], [8, 11, 0], [11, 15, 0]]);
    expect(s.S2.arrival).toBe(15);
    expect(s.S2.status).toBe(STATUS.LATE); // deadline 14
    expect(s.S2.lateness).toBe(1);
    expect(s.S2.waitHours).toBe(1);
    expect(s.S2.transitHours).toBe(10);
  });

  it('waits at an intermediate terminal when the next connection is full', () => {
    const input = net(
      ['A', 'B', 'C'],
      [C('AB', 'A', 'B', 1, 5), C('BC', 'B', 'C', 1, 1)],
      [S('S1', 'A', 'C', 0, 10), S('S2', 'A', 'C', 0, 10)],
    );
    const s = byId(run(input));
    expect(s.S1.arrival).toBe(2);
    expect(s.S2.legs.map((l) => [l.connectionId, l.depart, l.arrive, l.waitBefore])).toEqual([
      ['AB', 0, 1, 0],
      ['BC', 2, 3, 1],
    ]);
  });
});

describe('capacity', () => {
  it('never exceeds capacity when many shipments compete', () => {
    const shipments = Array.from({ length: 25 }, (_, i) => S(`S${i + 1}`, 'A', 'B', 0, 100));
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 2, 3)], shipments);
    const result = run(input);
    expect(Math.max(...result.reservations.AB)).toBe(3);
    // 25 shipments / 3 per slot -> slots 0..8, last arrival 8+2
    expect(Math.max(...result.shipments.map((s) => s.arrival))).toBe(10);
  });

  it('counts departures per slot regardless of traversal duration', () => {
    // 10h traversal, capacity 2: two enter in slot 0 even though they overlap for 10 hours.
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 10, 2)], [S('S1', 'A', 'B', 0, 50), S('S2', 'A', 'B', 0, 50), S('S3', 'A', 'B', 0, 50)]);
    const s = byId(run(input));
    expect([s.S1.departure, s.S2.departure, s.S3.departure]).toEqual([0, 0, 1]);
  });

  it('shares capacity between both directions of a bidirectional connection', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 9), S('S2', 'B', 'A', 0, 9)]);
    const s = byId(run(input));
    expect(s.S1.departure).toBe(0);
    expect(s.S2.departure).toBe(1);
  });

  it('keeps separate capacity when each direction is modelled as its own directed connection', () => {
    const input = net(
      ['A', 'B'],
      [C('AB', 'A', 'B', 1, 1, false), C('BA', 'B', 'A', 1, 1, false)],
      [S('S1', 'A', 'B', 0, 9), S('S2', 'B', 'A', 0, 9)],
    );
    const s = byId(run(input));
    expect(s.S1.departure).toBe(0);
    expect(s.S2.departure).toBe(0);
  });

  it('does not allow travel against a directed connection', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1, false)], [S('S1', 'B', 'A', 0, 9)]);
    const s = byId(run(input)).S1;
    expect(s.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.failure.code).toBe(FAILURE.DISCONNECTED);
  });

  it('treats parallel connections as independent capacity', () => {
    const input = net(['A', 'B'], [C('X', 'A', 'B', 1, 1), C('Y', 'A', 'B', 2, 1)], [S('S1', 'A', 'B', 0, 9), S('S2', 'A', 'B', 0, 9)]);
    const s = byId(run(input));
    expect([s.S1.arrival, s.S2.arrival]).toEqual([1, 2]); // S2: X@1 and Y@0 both arrive at 2
  });

  it('a capacity-0 base connection is rejected by validation, but a capacity cut to 0 acts as a closure of departures', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 2)], [S('S1', 'A', 'B', 0, 20)], [cut('D1', 'AB', 0, 6, 0)]);
    expect(byId(run(input)).S1.departure).toBe(6);
  });
});

describe('priority and ordering', () => {
  it('gives the earliest capacity to the higher-priority shipment regardless of id order', () => {
    const input = net(
      ['A', 'B'],
      [C('AB', 'A', 'B', 1, 1)],
      [S('S1', 'A', 'B', 0, 5, 1), S('S2', 'A', 'B', 0, 5, 4), S('S3', 'A', 'B', 0, 5, 2)],
    );
    const s = byId(run(input));
    expect(s.S2.arrival).toBe(1);
    expect(s.S3.arrival).toBe(2);
    expect(s.S1.arrival).toBe(3);
  });

  it('favours the tighter deadline within the same priority', () => {
    const input = net(
      ['A', 'B'],
      [C('AB', 'A', 'B', 1, 1)],
      [S('S1', 'A', 'B', 0, 9), S('S2', 'A', 'B', 0, 1)],
    );
    const s = byId(run(input));
    expect(s.S2.arrival).toBe(1);
    expect(s.S2.status).toBe(STATUS.ON_TIME);
    expect(s.S1.arrival).toBe(2);
  });

  it('classifies a missed deadline as late (not undeliverable) and explains the cause', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 5, 1)], [S('S1', 'A', 'B', 0, 3)]);
    const s = byId(run(input)).S1;
    expect(s.status).toBe(STATUS.LATE);
    expect(s.lateness).toBe(2);
    expect(s.lateCause).toBe('deadline_infeasible');
  });

  it('attributes lateness to congestion when the shipment would be on time on an empty network', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 1), S('S2', 'A', 'B', 0, 1)]);
    const s = byId(run(input));
    expect(s.S1.status).toBe(STATUS.ON_TIME);
    expect(s.S2.status).toBe(STATUS.LATE);
    expect(s.S2.lateCause).toBe('congestion');
  });

  it('breaks complete ties by shipment id (natural order: S2 before S10)', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S10', 'A', 'B', 0, 9), S('S2', 'A', 'B', 0, 9)]);
    const s = byId(run(input));
    expect(s.S2.arrival).toBe(1);
    expect(s.S10.arrival).toBe(2);
  });

  it('prefers the route with fewer legs when arrival times tie', () => {
    const input = net(
      ['A', 'B', 'C'],
      [C('AC', 'A', 'C', 2, 1), C('AB', 'A', 'B', 1, 1), C('BC', 'B', 'C', 1, 1)],
      [S('S1', 'A', 'C', 0, 9)],
    );
    expect(byId(run(input)).S1.routeKey).toBe('AC');
  });

  it('picks an alternative route when the shortest one is saturated', () => {
    // Direct A-C is 2h cap 1; detour A-B-C is 1h+1h cap 5. Both arrive at 2 for S1 -> fewer legs wins.
    const input = net(
      ['A', 'B', 'C'],
      [C('AC', 'A', 'C', 2, 1), C('AB', 'A', 'B', 1, 5), C('BC', 'B', 'C', 1, 5)],
      [S('S1', 'A', 'C', 0, 9), S('S2', 'A', 'C', 0, 9)],
    );
    const s = byId(run(input));
    expect(s.S1.routeKey).toBe('AC');
    expect(s.S1.arrival).toBe(2);
    expect(s.S2.routeKey).toBe('AB>BC'); // detour arrives at 2; waiting for AC@1 would arrive at 3
    expect(s.S2.arrival).toBe(2);
  });
});

describe('closures (half-open intervals)', () => {
  const base = () => net(['A', 'B'], [C('AB', 'A', 'B', 2, 5)], [S('S1', 'A', 'B', 0, 40)], []);

  it('does not use a closed connection while the traversal overlaps the closure', () => {
    const input = { ...base(), disruptions: [closure('D1', 'AB', 4, 10)] };
    const s = byId(run(input)).S1;
    expect(s.departure).toBe(0); // [0,2) does not overlap [4,10)
    const late = { ...base(), shipments: [S('S1', 'A', 'B', 3, 40)], disruptions: [closure('D1', 'AB', 4, 10)] };
    // departing at 3 would run [3,5) which overlaps [4,10) -> must wait until 10
    expect(byId(run(late)).S1.departure).toBe(10);
  });

  it('allows arriving exactly when the closure starts', () => {
    const input = { ...base(), shipments: [S('S1', 'A', 'B', 2, 40)], disruptions: [closure('D1', 'AB', 4, 10)] };
    const s = byId(run(input)).S1;
    expect(s.departure).toBe(2); // [2,4) touches but does not overlap [4,10)
    expect(s.arrival).toBe(4);
  });

  it('allows departing exactly when the closure ends', () => {
    const input = { ...base(), shipments: [S('S1', 'A', 'B', 5, 40)], disruptions: [closure('D1', 'AB', 4, 10)] };
    expect(byId(run(input)).S1.departure).toBe(10);
  });

  it('reroutes around a closed connection when an alternative exists', () => {
    const input = net(
      ['A', 'B', 'C'],
      [C('AC', 'A', 'C', 1, 3), C('AB', 'A', 'B', 2, 3), C('BC', 'B', 'C', 2, 3)],
      [S('S1', 'A', 'C', 0, 20)],
      [closure('D1', 'AC', 0, 30)],
    );
    const s = byId(run(input)).S1;
    expect(s.routeKey).toBe('AB>BC');
    expect(s.arrival).toBe(4);
  });

  it('never schedules any movement on a closed connection inside the closure window (multiple shipments)', () => {
    const shipments = Array.from({ length: 12 }, (_, i) => S(`S${i + 1}`, 'A', 'B', i, 80));
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 3, 2)], shipments, [closure('D1', 'AB', 5, 20)]);
    const result = run(input);
    for (const s of result.shipments) {
      for (const leg of s.legs) {
        const overlaps = leg.depart < 20 && 5 < leg.arrive;
        expect(overlaps).toBe(false);
      }
    }
  });

  it('marks shipments undeliverable when a closure outlasts the horizon', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 20)], [closure('D1', 'AB', 0, 500)]);
    const s = byId(run(input)).S1;
    expect(s.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.failure.code).toBe(FAILURE.DISRUPTION_BLOCKED);
    expect(s.failure.message).toMatch(/closure of AB/);
    expect(s.failure.disruptionIds).toEqual(['D1']);
  });
});

describe('other disruptions', () => {
  it('travel-time increase delays arrival only for departures inside the window', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 2, 5)], [S('S1', 'A', 'B', 0, 40), S('S2', 'A', 'B', 20, 40)], [slow('D1', 'AB', 0, 10, 5)]);
    const s = byId(run(input));
    expect(s.S1.arrival).toBe(7); // 0 + 2 + 5
    expect(s.S2.arrival).toBe(22);
  });

  it('may prefer a later departure that arrives earlier (non-FIFO travel time)', () => {
    // Departing in [0,3) costs +6h; leaving at 3 costs the base 2h. Depart at 3 -> arrive 5, beats 0 -> 8.
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 2, 5)], [S('S1', 'A', 'B', 0, 40)], [slow('D1', 'AB', 0, 3, 6)]);
    const s = byId(run(input)).S1;
    expect(s.departure).toBe(3);
    expect(s.arrival).toBe(5);
  });

  it('a slower connection makes the scheduler choose a different route', () => {
    const input = net(
      ['A', 'B', 'C'],
      [C('AC', 'A', 'C', 2, 1), C('AB', 'A', 'B', 1, 3), C('BC', 'B', 'C', 2, 3)],
      [S('S1', 'A', 'C', 0, 20)],
      [slow('D1', 'AC', 0, 24, 4)],
    );
    expect(byId(run(input)).S1.routeKey).toBe('AB>BC');
  });

  it('capacity reduction pushes shipments to later slots', () => {
    const shipments = [S('S1', 'A', 'B', 0, 40), S('S2', 'A', 'B', 0, 40), S('S3', 'A', 'B', 0, 40), S('S4', 'A', 'B', 0, 40)];
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 4)], shipments, [cut('D1', 'AB', 0, 10, 1)]);
    const result = run(input);
    expect(result.shipments.map((s) => s.departure).sort((a, b) => a - b)).toEqual([0, 1, 2, 3]);
  });

  it('release delay moves the earliest departure', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 4, 40)], [delay('D1', 'S1', 7)]);
    const s = byId(run(input)).S1;
    expect(s.effectiveRelease).toBe(11);
    expect(s.departure).toBe(11);
  });

  it('stacks multiple release delays on the same shipment', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 40)], [delay('D1', 'S1', 3), delay('D2', 'S1', 4)]);
    expect(byId(run(input)).S1.departure).toBe(7);
  });

  it('reports a release delay that pushes the shipment past the horizon', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 100, 200)], [delay('D1', 'S1', 80)]);
    const s = byId(run(input)).S1;
    expect(s.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.failure.code).toBe(FAILURE.RELEASE_BEYOND_HORIZON);
  });
});

describe('undeliverable shipments', () => {
  it('identifies disconnected terminals', () => {
    const input = net(
      ['A', 'B', 'C', 'D'],
      [C('AB', 'A', 'B', 1, 1), C('CD', 'C', 'D', 1, 1)],
      [S('S1', 'A', 'B', 0, 9), S('S2', 'A', 'D', 0, 99), S('S3', 'C', 'D', 0, 9)],
    );
    const s = byId(run(input));
    expect(s.S1.status).toBe(STATUS.ON_TIME);
    expect(s.S3.status).toBe(STATUS.ON_TIME);
    expect(s.S2.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.S2.failure.code).toBe(FAILURE.DISCONNECTED);
    expect(s.S2.legs).toEqual([]);
    expect(s.S2.arrival).toBeNull();
  });

  it('a terminal with no connections is unreachable', () => {
    const input = net(['A', 'B', 'Z'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'Z', 0, 99)]);
    expect(byId(run(input)).S1.failure.code).toBe(FAILURE.DISCONNECTED);
  });

  it('flags shipments whose transit cannot finish inside the 168h horizon', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 30, 1)], [S('S1', 'A', 'B', 150, 400), S('S2', 'A', 'B', 138, 400)]);
    const s = byId(run(input));
    expect(s.S1.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.S1.failure.code).toBe(FAILURE.TRANSIT_EXCEEDS_HORIZON);
    expect(s.S2.status).toBe(STATUS.ON_TIME); // arrives exactly at 168 -> allowed
    expect(s.S2.arrival).toBe(168);
  });

  it('release at or after the horizon is undeliverable', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', HORIZON_HOURS, 400)]);
    expect(byId(run(input)).S1.failure.code).toBe(FAILURE.RELEASE_BEYOND_HORIZON);
  });

  it('reports capacity exhaustion with the saturated connection', () => {
    // Capacity 1 per hour but only hours 165..167 left before the horizon: 3 slots, 4 shipments.
    const shipments = [1, 2, 3, 4].map((i) => S(`S${i}`, 'A', 'B', 165, 400));
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], shipments);
    const result = run(input);
    const failed = result.shipments.filter((s) => s.status === STATUS.UNDELIVERABLE);
    expect(failed).toHaveLength(1);
    expect(failed[0].failure.code).toBe(FAILURE.CAPACITY_EXHAUSTED);
    expect(failed[0].failure.connectionIds).toEqual(['AB']);
    expect(failed[0].failure.message).toMatch(/AB/);
  });

  it('blames the specific disruption that makes a shipment undeliverable', () => {
    const input = net(
      ['A', 'B', 'C'],
      [C('AB', 'A', 'B', 1, 1), C('BC', 'B', 'C', 1, 1)],
      [S('S1', 'A', 'C', 0, 400)],
      [closure('D1', 'BC', 0, 400), slow('D2', 'AB', 0, 5, 1)],
    );
    const s = byId(run(input)).S1;
    expect(s.failure.code).toBe(FAILURE.DISRUPTION_BLOCKED);
    expect(s.failure.disruptionIds).toEqual(['D1']);
  });
});

describe('edge cases', () => {
  it('handles an empty shipment list and an empty network', () => {
    const result = run(net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], []));
    expect(result.shipments).toEqual([]);
    expect(result.metrics.onTimePct).toBeNull();
    expect(result.metrics.operatingWindow).toBeNull();
    const none = run(net([], [], []));
    expect(none.shipments).toEqual([]);
  });

  it('treats origin == destination as invalid rather than free', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'A', 0, 9)]);
    const s = byId(run(input)).S1;
    expect(s.status).toBe(STATUS.UNDELIVERABLE);
    expect(s.failure.code).toBe(FAILURE.INVALID_REFERENCE);
  });

  it('survives references to unknown terminals', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'ZZ', 0, 9)]);
    expect(byId(run(input)).S1.failure.code).toBe(FAILURE.INVALID_REFERENCE);
  });

  it('rejects duplicate ids instead of silently merging records', () => {
    const input = net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], [S('S1', 'A', 'B', 0, 9), S('S1', 'A', 'B', 1, 9)]);
    expect(() => runSchedule(input)).toThrow(/Duplicate shipment id/);
  });

  it('keeps single-slot-per-hour pipelines tight when capacity is exactly sufficient', () => {
    const shipments = Array.from({ length: 5 }, (_, i) => S(`S${i + 1}`, 'A', 'B', i, i + 1));
    const result = run(net(['A', 'B'], [C('AB', 'A', 'B', 1, 1)], shipments));
    expect(result.shipments.every((s) => s.status === STATUS.ON_TIME)).toBe(true);
  });
});

describe('determinism', () => {
  const sample = () =>
    net(
      ['A', 'B', 'C', 'D'],
      [C('AB', 'A', 'B', 2, 1), C('BD', 'B', 'D', 2, 1), C('AC', 'A', 'C', 3, 2), C('CD', 'C', 'D', 3, 2), C('BC', 'B', 'C', 1, 1)],
      Array.from({ length: 14 }, (_, i) => S(`S${i + 1}`, i % 2 ? 'A' : 'D', i % 2 ? 'D' : 'A', i % 5, 14 + (i % 4), (i % 4) + 1)),
      [closure('D1', 'AB', 3, 8)],
    );

  it('produces identical output for identical input', () => {
    expect(runSchedule(sample())).toEqual(runSchedule(sample()));
  });

  it('is independent of the order of input arrays', () => {
    const a = sample();
    const b = sample();
    b.shipments.reverse();
    b.connections.reverse();
    b.terminals.reverse();
    expect(runSchedule(b)).toEqual(runSchedule(a));
  });

  it('does not mutate its input', () => {
    const input = sample();
    const copy = structuredClone(input);
    runSchedule(input);
    expect(input).toEqual(copy);
  });

  it('refinement never makes the objective worse than the plain priority pass', () => {
    const input = sample();
    const plain = runSchedule(input, { refinementPasses: 0 });
    const refined = runSchedule(input);
    const cmp = (a, b) => {
      for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return a[i] - b[i];
      return 0;
    };
    expect(cmp(refined.objective, plain.objective)).toBeLessThanOrEqual(0);
    expect(verifySchedule(input, refined).ok).toBe(true);
    expect(verifySchedule(input, plain).ok).toBe(true);
  });
});
