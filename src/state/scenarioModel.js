import { DEFAULT_SEED, DEFAULT_SHIPMENT_COUNT, generateNetwork } from '../data/generator.js';
import { maxIdNumber } from '../engine/ids.js';

export const BASELINE_ID = 'baseline';
export const MAX_SCENARIOS = 25;

const PAD = { terminal: 1, connection: 2, shipment: 3, disruption: 1 };
const PREFIX = { terminal: 'T', connection: 'C', shipment: 'S', disruption: 'D' };

export function deepFreeze(value) {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const v of Object.values(value)) deepFreeze(v);
  }
  return value;
}

export function bodyOf(scenario) {
  return {
    network: scenario.network,
    shipments: scenario.shipments,
    disruptions: scenario.disruptions,
  };
}

/** The input object the scheduling engine expects. */
export function engineInput(scenario) {
  return {
    terminals: scenario.network.terminals,
    connections: scenario.network.connections,
    shipments: scenario.shipments,
    disruptions: scenario.disruptions,
  };
}

export function computeCounters(body) {
  return {
    terminal: maxIdNumber(body.network.terminals.map((x) => x.id)) + 1,
    connection: maxIdNumber(body.network.connections.map((x) => x.id)) + 1,
    shipment: maxIdNumber(body.shipments.map((x) => x.id)) + 1,
    disruption: maxIdNumber(body.disruptions.map((x) => x.id)) + 1,
  };
}

/**
 * Create a scenario record. `origin` is a deep snapshot of the inputs at creation time,
 * used by "Reset scenario". `counters` make new ids monotonic so a deleted id is never
 * handed out again within a scenario.
 */
export function makeScenario({ id, name, description = '', source, parentId = null, body, expected = null, counters, origin }) {
  const copy = structuredClone({
    network: body.network,
    shipments: body.shipments,
    disruptions: body.disruptions ?? [],
  });
  const exp = expected ? structuredClone(expected) : null;
  return {
    id,
    name,
    description,
    source,
    parentId,
    locked: false,
    rev: 0,
    network: copy.network,
    shipments: copy.shipments,
    disruptions: copy.disruptions,
    expected: exp,
    counters: counters ?? computeCounters(copy),
    origin: origin ?? structuredClone({ ...copy, expected: exp }),
  };
}

let baselineCache = null;

/** The seeded default scenario. Deeply frozen: nothing can mutate it. */
export function getBaseline() {
  if (!baselineCache) {
    const { terminals, connections, shipments } = generateNetwork(DEFAULT_SEED, DEFAULT_SHIPMENT_COUNT);
    const scenario = makeScenario({
      id: BASELINE_ID,
      name: 'Baseline (seeded)',
      description: `8 terminals, ${connections.length} connections and ${shipments.length} shipments generated deterministically from seed ${DEFAULT_SEED}. Read-only: fork it to experiment.`,
      source: 'seed',
      body: { network: { terminals, connections }, shipments, disruptions: [] },
    });
    scenario.locked = true;
    scenario.origin = null;
    baselineCache = deepFreeze(scenario);
  }
  return baselineCache;
}

/** Next unused id of a kind, plus the updated counters. Follows the zero-padding style of existing ids (S3 -> S4, S003 -> S004). */
export function allocateId(scenario, kind) {
  const list =
    kind === 'terminal' ? scenario.network.terminals
    : kind === 'connection' ? scenario.network.connections
    : kind === 'shipment' ? scenario.shipments
    : scenario.disruptions;
  const existing = new Set(list.map((x) => x.id));
  const style = list.map((x) => x.id.match(new RegExp(`^${PREFIX[kind]}(\\d+)$`))).find(Boolean);
  const width = style ? (style[1].startsWith('0') ? style[1].length : 1) : PAD[kind];
  const make = (n) => `${PREFIX[kind]}${String(n).padStart(width, '0')}`;
  let n = scenario.counters[kind];
  while (existing.has(make(n))) n += 1;
  return { id: make(n), counters: { ...scenario.counters, [kind]: n + 1 } };
}
