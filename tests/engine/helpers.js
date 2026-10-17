// Tiny builders so tests read like the scenarios they describe.
export const T = (id, name = id) => ({ id, name, x: 0, y: 0 });
export const C = (id, from, to, travelTime, capacity, bidirectional = true) => ({
  id, from, to, travelTime, capacity, bidirectional,
});
export const S = (id, origin, destination, release, deadline, priority = 2) => ({
  id, origin, destination, release, deadline, priority,
});
export const closure = (id, connectionId, startHour, endHour) => ({ id, type: 'closure', connectionId, startHour, endHour });
export const slow = (id, connectionId, startHour, endHour, extraHours) => ({ id, type: 'travel_time', connectionId, startHour, endHour, extraHours });
export const cut = (id, connectionId, startHour, endHour, capacity) => ({ id, type: 'capacity', connectionId, startHour, endHour, capacity });
export const delay = (id, shipmentId, delayHours) => ({ id, type: 'release_delay', shipmentId, delayHours });

export function net(terminalIds, connections, shipments, disruptions = []) {
  return {
    terminals: terminalIds.map((id) => T(id)),
    connections,
    shipments,
    disruptions,
  };
}

export const byId = (result) => Object.fromEntries(result.shipments.map((s) => [s.id, s]));

/** The spec's reference scenario. */
export function referenceInput() {
  return net(
    ['A', 'B', 'C'],
    [C('AB', 'A', 'B', 1, 1), C('BC', 'B', 'C', 1, 1)],
    [S('S1', 'A', 'C', 8, 20), S('S2', 'A', 'C', 8, 20), S('S3', 'A', 'C', 8, 20)],
  );
}
