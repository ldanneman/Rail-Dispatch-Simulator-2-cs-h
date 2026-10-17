import { createRng } from '../engine/prng.js';
import { buildAdjacency } from '../engine/network.js';
import { buildConnectionProfiles, emptyReservations } from '../engine/profile.js';
import { findEarliestRoute } from '../engine/search.js';

export const DEFAULT_SEED = 11;
export const DEFAULT_SHIPMENT_COUNT = 100;

// Entirely fictional freight terminals. x/y are map coordinates (0-100 by 0-64).
const TERMINALS = [
  { id: 'T1', name: 'Ironvale Yard', x: 8, y: 32 },
  { id: 'T2', name: 'Harrow Junction', x: 26, y: 11 },
  { id: 'T3', name: 'Cobalt Ridge', x: 26, y: 53 },
  { id: 'T4', name: 'Mereford Central', x: 50, y: 32 },
  { id: 'T5', name: 'Saltmarsh Port', x: 74, y: 11 },
  { id: 'T6', name: 'Tarn Basin', x: 74, y: 53 },
  { id: 'T7', name: 'Quillon Works', x: 92, y: 32 },
  { id: 'T8', name: 'Dunmore Siding', x: 50, y: 59 },
];

// [from, to, minTravel, maxTravel, minCapacity, maxCapacity]
const LINKS = [
  ['T1', 'T2', 3, 4, 1, 1],
  ['T1', 'T3', 3, 4, 1, 1],
  ['T1', 'T4', 4, 6, 1, 2],
  ['T2', 'T4', 3, 4, 1, 2],
  ['T3', 'T4', 3, 4, 1, 2],
  ['T2', 'T5', 5, 7, 1, 1],
  ['T4', 'T5', 3, 4, 1, 2],
  ['T4', 'T6', 3, 4, 1, 2],
  ['T3', 'T8', 3, 5, 1, 1],
  ['T5', 'T7', 3, 4, 1, 1],
  ['T6', 'T7', 3, 4, 1, 1],
  ['T4', 'T8', 2, 3, 1, 2],
  ['T6', 'T8', 3, 5, 1, 1],
  ['T4', 'T7', 5, 7, 1, 2],
  ['T5', 'T6', 6, 8, 1, 1],
];

// Heavy freight lanes [origin, destination, weight]; about half of all shipments follow one of them.
const LANES = [
  ['T1', 'T7', 5],
  ['T7', 'T1', 3],
  ['T3', 'T5', 3],
  ['T2', 'T6', 2],
  ['T8', 'T5', 1],
];
const LANE_SHARE = 75; // percent

const CARGO = ['Grain', 'Steel coil', 'Containers', 'Lumber', 'Chemicals', 'Machinery', 'Coal', 'Fertilizer', 'Automotive', 'Paper'];
const ORIGIN_WEIGHTS = [3, 2, 2, 1, 3, 2, 3, 1]; // T1..T8
const DEST_WEIGHTS = [2, 2, 2, 2, 3, 3, 3, 2];
const WAVE_CENTERS = [6, 30, 54];
// Slack above free-flow transit, by priority (1..4): [min, max] hours.
const SLACK = { 4: [0, 1], 3: [0, 3], 2: [1, 8], 1: [6, 24] };
const PRIORITY_WEIGHTS = [20, 50, 20, 10]; // index 0 => priority 1

const pad = (n, width) => String(n).padStart(width, '0');

/**
 * Deterministic network + shipment generator: the same (seed, shipmentCount) always
 * produces exactly the same output. Uses only integer PRNG arithmetic.
 * Returns { terminals, connections, shipments }.
 */
export function generateNetwork(seed = DEFAULT_SEED, shipmentCount = DEFAULT_SHIPMENT_COUNT) {
  const rng = createRng(seed);
  const terminals = TERMINALS.map((t) => ({ ...t }));
  const connections = LINKS.map(([from, to, tMin, tMax, cMin, cMax], i) => ({
    id: `C${pad(i + 1, 2)}`,
    from,
    to,
    travelTime: rng.int(tMin, tMax),
    capacity: rng.int(cMin, cMax),
    bidirectional: true,
  }));

  // Free-flow transit time between any pair, to give each shipment a realistic deadline.
  const adjacency = buildAdjacency(terminals, connections);
  const profiles = buildConnectionProfiles(connections, []);
  const empty = emptyReservations(connections);
  const freeTransit = (origin, destination, release) => {
    const route = findEarliestRoute({ adjacency, profiles, reservations: empty, origin, destination, startTime: release });
    return route ? route.arrival - release : null;
  };

  const shipments = [];
  for (let i = 0; i < shipmentCount; i++) {
    let origin;
    let destination;
    if (rng.int(0, 99) < LANE_SHARE) {
      const [from, to] = LANES[rng.weighted(LANES.map((l) => l[2]))];
      origin = terminals.findIndex((t) => t.id === from);
      destination = terminals.findIndex((t) => t.id === to);
    } else {
      origin = rng.weighted(ORIGIN_WEIGHTS);
      destination = rng.weighted(DEST_WEIGHTS);
      if (destination === origin) destination = (destination + 1 + rng.int(0, terminals.length - 2)) % terminals.length;
    }
    const priority = rng.weighted(PRIORITY_WEIGHTS) + 1;
    const lateBooking = rng.int(0, 99) < 4;
    const release = lateBooking
      ? rng.int(150, 166)
      : Math.max(0, WAVE_CENTERS[rng.int(0, WAVE_CENTERS.length - 1)] + rng.int(-1, 1));
    const [slackMin, slackMax] = SLACK[priority];
    const slack = rng.int(slackMin, slackMax);
    const transit = freeTransit(terminals[origin].id, terminals[destination].id, release);
    shipments.push({
      id: `S${pad(i + 1, 3)}`,
      origin: terminals[origin].id,
      destination: terminals[destination].id,
      release,
      deadline: release + (transit ?? 24) + slack,
      priority,
      cargo: CARGO[rng.int(0, CARGO.length - 1)],
    });
  }
  return { terminals, connections, shipments };
}
