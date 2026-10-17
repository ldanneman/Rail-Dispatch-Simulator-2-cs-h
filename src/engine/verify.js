import { DISRUPTION, HORIZON_HOURS, STATUS } from './constants.js';
import { effectiveRelease } from './profile.js';

/*
 * Independent schedule checker. It re-derives travel time, closures and capacity
 * straight from the input disruption list (NOT from the profile arrays the
 * scheduler used) and re-counts every reservation from the shipment legs, so a
 * bug in the scheduler cannot hide itself here.
 */

export function travelTimeAt(connection, slot, disruptions) {
  let tt = connection.travelTime;
  for (const d of disruptions) {
    if (d.type === DISRUPTION.TRAVEL_TIME && d.connectionId === connection.id && slot >= d.startHour && slot < d.endHour) {
      tt += d.extraHours;
    }
  }
  return tt;
}

export function capacityAt(connection, slot, disruptions) {
  let cap = connection.capacity;
  for (const d of disruptions) {
    if (d.type === DISRUPTION.CAPACITY && d.connectionId === connection.id && slot >= d.startHour && slot < d.endHour) {
      cap = Math.min(cap, d.capacity);
    }
  }
  return cap;
}

/** A movement departing at `depart` and arriving at `arrive` overlaps closure [s, e) iff depart < e && s < arrive. */
export function closureOverlap(connection, depart, arrive, disruptions) {
  return disruptions.find(
    (d) => d.type === DISRUPTION.CLOSURE && d.connectionId === connection.id && depart < d.endHour && d.startHour < arrive,
  );
}

export function verifySchedule(input, result) {
  const violations = [];
  const horizon = result.horizon ?? HORIZON_HOURS;
  const disruptions = input.disruptions ?? [];
  const conns = new Map(input.connections.map((c) => [c.id, c]));
  const shipmentsById = new Map(input.shipments.map((s) => [s.id, s]));
  const add = (code, message, extra = {}) => violations.push({ code, message, ...extra });

  const seen = new Set();
  for (const r of result.shipments) {
    if (seen.has(r.id)) add('duplicate_result', `Shipment ${r.id} appears more than once in the result.`, { shipmentId: r.id });
    seen.add(r.id);
  }
  for (const s of input.shipments) {
    if (!seen.has(s.id)) add('missing_result', `Shipment ${s.id} has no result.`, { shipmentId: s.id });
  }

  const usage = new Map(); // `${connectionId}@${slot}` -> count
  let movements = 0;

  for (const r of result.shipments) {
    const s = shipmentsById.get(r.id);
    if (!s) {
      add('unknown_shipment', `Result for unknown shipment ${r.id}.`, { shipmentId: r.id });
      continue;
    }
    if (r.status === STATUS.UNDELIVERABLE) {
      if (r.legs.length) add('undeliverable_with_legs', `${r.id} is undeliverable but has legs.`, { shipmentId: r.id });
      if (!r.failure || !r.failure.message) add('missing_reason', `${r.id} is undeliverable without a reason.`, { shipmentId: r.id });
      continue;
    }
    if (!r.legs.length) {
      add('routed_without_legs', `${r.id} is marked ${r.status} but has no legs.`, { shipmentId: r.id });
      continue;
    }

    const release = effectiveRelease(s, disruptions);
    let ready = release;
    let at = s.origin;
    r.legs.forEach((leg, i) => {
      const c = conns.get(leg.connectionId);
      const where = { shipmentId: r.id, connectionId: leg.connectionId, slot: leg.depart };
      if (!c) {
        add('unknown_connection', `${r.id} leg ${i + 1} uses unknown connection ${leg.connectionId}.`, where);
        return;
      }
      const forward = c.from === at && c.to === leg.to;
      const backward = c.bidirectional !== false && c.to === at && c.from === leg.to;
      if (leg.from !== at || !(forward || backward)) {
        add('broken_route', `${r.id} leg ${i + 1} (${leg.from}->${leg.to} on ${c.id}) does not continue from ${at} along an allowed direction.`, where);
      }
      if (leg.depart < ready) {
        add(
          i === 0 ? 'departs_before_release' : 'departs_before_arrival',
          i === 0
            ? `${r.id} departs at ${leg.depart}, before its release time ${release}.`
            : `${r.id} departs leg ${i + 1} at ${leg.depart}, before arriving at ${at} (${ready}).`,
          where,
        );
      }
      if (leg.depart < 0 || leg.depart >= horizon) add('outside_horizon', `${r.id} departs at ${leg.depart}, outside [0, ${horizon}).`, where);
      const tt = travelTimeAt(c, leg.depart, disruptions);
      if (leg.arrive !== leg.depart + tt) {
        add('wrong_travel_time', `${r.id} on ${c.id}: departs ${leg.depart}, arrives ${leg.arrive}, expected ${leg.depart + tt}.`, where);
      }
      if (leg.arrive > horizon) add('arrives_after_horizon', `${r.id} arrives at ${leg.arrive}, after the horizon ${horizon}.`, where);
      const closure = closureOverlap(c, leg.depart, leg.depart + tt, disruptions);
      if (closure) {
        add('closure_violation', `${r.id} traverses ${c.id} during [${leg.depart}, ${leg.depart + tt}), overlapping closure [${closure.startHour}, ${closure.endHour}).`, where);
      }
      const key = `${c.id}@${leg.depart}`;
      usage.set(key, (usage.get(key) ?? 0) + 1);
      movements += 1;
      ready = leg.arrive;
      at = leg.to;
    });
    if (at !== s.destination) add('wrong_destination', `${r.id} ends at ${at}, expected ${s.destination}.`, { shipmentId: r.id });
    const arrival = r.legs[r.legs.length - 1].arrive;
    if (r.arrival !== arrival) add('arrival_mismatch', `${r.id} reports arrival ${r.arrival} but its last leg arrives at ${arrival}.`, { shipmentId: r.id });
    const expected = arrival <= s.deadline ? STATUS.ON_TIME : STATUS.LATE;
    if (r.status !== expected) add('status_mismatch', `${r.id} is ${r.status} but arrival ${arrival} vs deadline ${s.deadline} implies ${expected}.`, { shipmentId: r.id });
  }

  for (const [key, count] of usage) {
    const [connectionId, slotText] = key.split('@');
    const slot = Number(slotText);
    const c = conns.get(connectionId);
    const cap = capacityAt(c, slot, disruptions);
    if (count > cap) {
      add('capacity_exceeded', `${connectionId} carries ${count} movements in slot ${slot}; capacity is ${cap}.`, { connectionId, slot });
    }
  }

  // The scheduler's own reservation table must match what the legs actually use.
  if (result.reservations) {
    for (const c of input.connections) {
      const table = result.reservations[c.id];
      for (let slot = 0; slot < horizon; slot++) {
        const counted = usage.get(`${c.id}@${slot}`) ?? 0;
        if ((table?.[slot] ?? 0) !== counted) {
          add('reservation_mismatch', `${c.id} slot ${slot}: reservation table says ${table?.[slot] ?? 0}, legs use ${counted}.`, { connectionId: c.id, slot });
        }
      }
    }
  }

  return { ok: violations.length === 0, violations, checkedShipments: result.shipments.length, checkedMovements: movements };
}
