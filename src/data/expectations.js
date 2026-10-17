import { STATUS } from '../engine/constants.js';

/**
 * Compare a scenario's `expected` block with an actual schedule result.
 * Returns [{ shipmentId, field, expected, actual, pass }] - one row per checked field.
 */
export function checkExpectations(expected, result) {
  if (!expected?.shipments) return [];
  const byId = new Map(result.shipments.map((s) => [s.id, s]));
  const rows = [];
  for (const [id, e] of Object.entries(expected.shipments)) {
    const actual = byId.get(id);
    const add = (field, exp, act, pass) => rows.push({ shipmentId: id, field, expected: exp, actual: act, pass });
    if (!actual) {
      add('present', 'in schedule', 'missing', false);
      continue;
    }
    if (e.status !== undefined) add('status', e.status, actual.status, e.status === actual.status);
    if (e.arrival !== undefined) add('arrival', e.arrival, actual.arrival ?? STATUS.UNDELIVERABLE, e.arrival === actual.arrival);
    if (e.route !== undefined) {
      const route = actual.legs.map((l) => l.connectionId);
      add('route', e.route.join(' > '), route.join(' > ') || '—', JSON.stringify(route) === JSON.stringify(e.route));
    }
    if (e.departures !== undefined) {
      const deps = actual.legs.map((l) => l.depart);
      add('departures', e.departures.join(', '), deps.join(', ') || '—', JSON.stringify(deps) === JSON.stringify(e.departures));
    }
  }
  return rows;
}
