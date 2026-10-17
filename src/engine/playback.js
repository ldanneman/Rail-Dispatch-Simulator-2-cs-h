import { STATUS } from './constants.js';

/**
 * Where is every shipment at hour `t`? Pure function of a schedule result, used by the
 * Test Lab playback. Hour boundaries follow the scheduler's half-open convention:
 * a movement is in transit for depart <= t < arrive and is delivered from t >= arrival.
 *
 * Returns { counts, movements, waiting } where
 *   counts     { notReleased, waiting, inTransit, delivered, undeliverable }
 *   movements  [{ key, label, connectionId, from, to, progress }]
 *   waiting    { [terminalId]: number }  shipments sitting at a terminal (released, not moving, not delivered)
 */
export function snapshotAt(result, t) {
  const counts = { notReleased: 0, waiting: 0, inTransit: 0, delivered: 0, undeliverable: 0 };
  const movements = [];
  const waiting = {};
  for (const s of result.shipments) {
    if (s.status === STATUS.UNDELIVERABLE) {
      counts.undeliverable += 1;
      continue;
    }
    if (t < s.effectiveRelease) {
      counts.notReleased += 1;
      continue;
    }
    if (t >= s.arrival) {
      counts.delivered += 1;
      continue;
    }
    const moving = s.legs.find((l) => l.depart <= t && t < l.arrive);
    if (moving) {
      counts.inTransit += 1;
      movements.push({
        key: `${s.id}-${moving.index}`,
        label: `${s.id} on ${moving.connectionId} (${moving.from}→${moving.to}), h${moving.depart}→h${moving.arrive}`,
        connectionId: moving.connectionId,
        from: moving.from,
        to: moving.to,
        progress: (t - moving.depart) / (moving.arrive - moving.depart),
      });
      continue;
    }
    counts.waiting += 1;
    const done = s.legs.filter((l) => l.arrive <= t);
    const at = done.length ? done[done.length - 1].to : s.origin;
    waiting[at] = (waiting[at] ?? 0) + 1;
  }
  return { counts, movements, waiting };
}
