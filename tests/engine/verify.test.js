import { describe, expect, it } from 'vitest';
import { buildConnectionProfiles, runSchedule, verifySchedule, STATUS } from '../../src/engine/index.js';
import { capacityAt, closureOverlap, travelTimeAt } from '../../src/engine/verify.js';
import { effectiveRelease } from '../../src/engine/profile.js';
import { C, S, closure, net, referenceInput } from './helpers.js';
import { oracleEarliestArrival, randomInput } from './oracle.js';

const codes = (v) => v.violations.map((x) => x.code);

describe('verifySchedule catches broken schedules (negative tests)', () => {
  const input = () => net(['A', 'B', 'C'], [C('AB', 'A', 'B', 1, 1), C('BC', 'B', 'C', 1, 1)], [S('S1', 'A', 'C', 8, 20), S('S2', 'A', 'C', 8, 20)], [closure('D1', 'BC', 30, 40)]);
  const fresh = () => {
    const i = input();
    return { i, r: structuredClone(runSchedule(i)) };
  };
  const s = (r, id) => r.shipments.find((x) => x.id === id);

  it('accepts an untouched schedule', () => {
    const { i, r } = fresh();
    expect(verifySchedule(i, r).ok).toBe(true);
  });

  it('flags capacity exceeded', () => {
    const { i, r } = fresh();
    const l = s(r, 'S2').legs[0];
    l.depart = 8; l.arrive = 9; // same AB slot as S1
    expect(codes(verifySchedule(i, r))).toContain('capacity_exceeded');
  });

  it('flags a departure before the release time', () => {
    const { i, r } = fresh();
    s(r, 'S1').legs[0].depart = 7; s(r, 'S1').legs[0].arrive = 8;
    expect(codes(verifySchedule(i, r))).toContain('departs_before_release');
  });

  it('flags a departure before arriving at the transfer terminal', () => {
    const { i, r } = fresh();
    s(r, 'S1').legs[1].depart = 8; s(r, 'S1').legs[1].arrive = 9;
    expect(codes(verifySchedule(i, r))).toContain('departs_before_arrival');
  });

  it('flags use of a closed connection', () => {
    const { i, r } = fresh();
    const l = s(r, 'S1').legs[1];
    l.depart = 31; l.arrive = 32;
    expect(codes(verifySchedule(i, r))).toContain('closure_violation');
  });

  it('flags wrong travel time, broken routes and wrong status', () => {
    const { i, r } = fresh();
    s(r, 'S1').legs[0].arrive = 12;
    s(r, 'S1').status = STATUS.LATE;
    s(r, 'S2').legs[1].from = 'A';
    const found = codes(verifySchedule(i, r));
    expect(found).toEqual(expect.arrayContaining(['wrong_travel_time', 'broken_route', 'status_mismatch']));
  });

  it('flags a reservation table that disagrees with the legs', () => {
    const { i, r } = fresh();
    r.reservations.AB[100] = 1;
    expect(codes(verifySchedule(i, r))).toContain('reservation_mismatch');
  });

  it('flags missing results and undeliverable shipments without a reason', () => {
    const { i, r } = fresh();
    r.shipments.pop();
    expect(codes(verifySchedule(i, r))).toContain('missing_result');
    const s1 = s(r, 'S1');
    Object.assign(s1, { status: STATUS.UNDELIVERABLE, legs: [], failure: null, arrival: null });
    expect(codes(verifySchedule(i, r))).toContain('missing_reason');
  });

  it('accepts the reference scenario', () => {
    const i = referenceInput();
    expect(verifySchedule(i, runSchedule(i)).ok).toBe(true);
  });
});

describe('randomised validation against an independent brute-force oracle', () => {
  const seeds = Array.from({ length: 150 }, (_, i) => i + 1);

  it('verifier-clean schedules and exact per-shipment earliest arrivals for 150 random networks', () => {
    for (const seed of seeds) {
      const input = randomInput(seed);
      const result = runSchedule(input);
      const check = verifySchedule(input, result);
      expect(check.violations, `seed ${seed}`).toEqual([]);

      // Replay the scheduler's processing order and ask the oracle for each shipment's best
      // arrival given only the movements reserved before it.
      const used = new Map();
      const byId = new Map(result.shipments.map((r) => [r.id, r]));
      const ships = new Map(input.shipments.map((x) => [x.id, x]));
      for (const id of result.order) {
        const r = byId.get(id);
        const s = ships.get(id);
        const start = effectiveRelease(s, input.disruptions);
        const expected = oracleEarliestArrival(input, used, s.origin, s.destination, start);
        expect(r.arrival, `seed ${seed} shipment ${id}`).toBe(expected);
        for (const leg of r.legs) used.set(`${leg.connectionId}@${leg.depart}`, (used.get(`${leg.connectionId}@${leg.depart}`) ?? 0) + 1);
      }
    }
  });

  it('profile arrays agree with the verifier\'s direct per-slot rules', () => {
    for (const seed of seeds) {
      const input = randomInput(seed);
      const profiles = buildConnectionProfiles(input.connections, input.disruptions);
      for (const c of input.connections) {
        for (let d = 0; d < 168; d++) {
          const tt = travelTimeAt(c, d, input.disruptions);
          const closed = Boolean(closureOverlap(c, d, d + tt, input.disruptions));
          expect(profiles[c.id].travelTime[d], `seed ${seed} ${c.id}@${d}`).toBe(tt);
          expect(profiles[c.id].closed[d]).toBe(closed);
          expect(profiles[c.id].capacity[d]).toBe(closed ? 0 : capacityAt(c, d, input.disruptions));
        }
      }
    }
  });

  it('scheduling the same random input twice is bit-for-bit identical', () => {
    for (const seed of seeds.slice(0, 40)) {
      const input = randomInput(seed);
      expect(runSchedule(input)).toEqual(runSchedule(structuredClone(input)));
    }
  });
});
