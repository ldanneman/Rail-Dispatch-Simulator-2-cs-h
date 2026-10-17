import { SCHEMA_ID, SCHEMA_VERSION } from './validation.js';

/**
 * Scenario -> export document (the single documented JSON schema; see schema/rail-scenario.schema.json).
 * Only portable inputs are exported: never results, never internal ids/counters/snapshots.
 */
export function scenarioToDocument(scenario) {
  const doc = {
    schema: SCHEMA_ID,
    version: SCHEMA_VERSION,
    name: scenario.name,
    description: scenario.description ?? '',
    network: {
      terminals: scenario.network.terminals.map((t) => ({ id: t.id, name: t.name, x: t.x, y: t.y })),
      connections: scenario.network.connections.map((c) => ({
        id: c.id,
        from: c.from,
        to: c.to,
        travelTime: c.travelTime,
        capacity: c.capacity,
        bidirectional: c.bidirectional !== false,
      })),
    },
    shipments: scenario.shipments.map((s) => {
      const out = {
        id: s.id,
        origin: s.origin,
        destination: s.destination,
        release: s.release,
        deadline: s.deadline,
        priority: s.priority,
      };
      if (s.cargo) out.cargo = s.cargo;
      return out;
    }),
    disruptions: scenario.disruptions.map((d) => ({ ...d })),
  };
  if (scenario.expected) doc.expected = structuredClone(scenario.expected);
  return doc;
}

export function documentToJson(doc) {
  return `${JSON.stringify(doc, null, 2)}\n`;
}

export function exportFileName(scenario) {
  const slug = scenario.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'scenario';
  return `rail-dispatch-${slug}.json`;
}

/** Schedule -> CSV, one row per movement, for independent inspection in a spreadsheet. */
export function scheduleToCsv(result) {
  const rows = [['shipment', 'priority', 'status', 'leg', 'connection', 'from', 'to', 'depart', 'arrive', 'wait_before', 'release', 'deadline', 'final_arrival']];
  for (const s of result.shipments) {
    if (!s.legs.length) {
      rows.push([s.id, s.priority, s.status, '', '', s.origin, s.destination, '', '', '', s.effectiveRelease, s.deadline, '']);
      continue;
    }
    for (const l of s.legs) {
      rows.push([s.id, s.priority, s.status, l.index + 1, l.connectionId, l.from, l.to, l.depart, l.arrive, l.waitBefore, s.effectiveRelease, s.deadline, s.arrival]);
    }
  }
  return rows.map((r) => r.join(',')).join('\n') + '\n';
}
