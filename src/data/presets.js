import { generateNetwork } from './generator.js';
import { DISRUPTION } from '../engine/constants.js';

/*
 * Preset test scenarios. Every preset except the disrupted baseline carries an `expected`
 * block with hand-computed results (see the Obsidian note "Testing Approach and Known
 * Limitations"). The Test Lab "Expectations" panel compares these with the engine's output,
 * and tests/data/presets.test.js asserts that they match.
 */

const t = (id, name, x, y) => ({ id, name: name ?? id, x, y });
const c = (id, from, to, travelTime, capacity, bidirectional = true) => ({ id, from, to, travelTime, capacity, bidirectional });
const s = (id, origin, destination, release, deadline, priority = 2, cargo) => {
  const out = { id, origin, destination, release, deadline, priority };
  if (cargo) out.cargo = cargo;
  return out;
};

function threeTerminal() {
  return {
    key: 'reference-three-terminal',
    name: 'Reference: three terminals (A-B-C)',
    description:
      'The specification\'s reference scenario. A-B and B-C each take 1 hour with capacity 1 per hour and there is no direct A-C link. Three identical shipments A->C are released at hour 8, so the earliest feasible arrivals are hours 10, 11 and 12.',
    network: {
      terminals: [t('A', 'Terminal A', 10, 32), t('B', 'Terminal B', 50, 32), t('C', 'Terminal C', 90, 32)],
      connections: [c('AB', 'A', 'B', 1, 1), c('BC', 'B', 'C', 1, 1)],
    },
    shipments: [s('S1', 'A', 'C', 8, 14), s('S2', 'A', 'C', 8, 14), s('S3', 'A', 'C', 8, 14)],
    disruptions: [],
    expected: {
      notes: 'S1 departs AB at 8 and BC at 9 (arrives 10); S2 trails by one hour (arrives 11); S3 by two (arrives 12). All on time.',
      shipments: {
        S1: { status: 'on_time', arrival: 10, route: ['AB', 'BC'], departures: [8, 9] },
        S2: { status: 'on_time', arrival: 11, route: ['AB', 'BC'], departures: [9, 10] },
        S3: { status: 'on_time', arrival: 12, route: ['AB', 'BC'], departures: [10, 11] },
      },
    },
  };
}

const diamondNetwork = () => ({
  terminals: [t('A', 'Terminal A', 10, 32), t('B', 'Terminal B', 50, 10), t('C', 'Terminal C', 50, 54), t('D', 'Terminal D', 90, 32)],
  connections: [c('AB', 'A', 'B', 2, 2), c('BD', 'B', 'D', 2, 2), c('AC', 'A', 'C', 3, 2), c('CD', 'C', 'D', 3, 2)],
});

function normalRouting() {
  return {
    key: 'normal-routing',
    name: 'Normal routing (diamond network)',
    description:
      'Four terminals with a fast northern route A-B-D (2h + 2h, capacity 2) and a slower southern route A-C-D (3h + 3h, capacity 2). Three shipments A->D at hour 0 and one D->A at hour 2. Two use the fast route at once; the third queues one hour; the return trip uses B shared capacity.',
    network: diamondNetwork(),
    shipments: [s('S1', 'A', 'D', 0, 8), s('S2', 'A', 'D', 0, 8), s('S3', 'A', 'D', 0, 8), s('S4', 'D', 'A', 2, 12)],
    disruptions: [],
    expected: {
      notes: 'S1 and S2 take AB@0, BD@2 (arrive 4). AB slot 0 is then full, so S3 departs AB@1 and BD@3 (arrives 5). S4 (D->A, released 2): BD slot 2 is full, BD@3 reaches B at 5, AB@5 reaches A at 7.',
      shipments: {
        S1: { status: 'on_time', arrival: 4, route: ['AB', 'BD'], departures: [0, 2] },
        S2: { status: 'on_time', arrival: 4, route: ['AB', 'BD'], departures: [0, 2] },
        S3: { status: 'on_time', arrival: 5, route: ['AB', 'BD'], departures: [1, 3] },
        S4: { status: 'on_time', arrival: 7, route: ['BD', 'AB'], departures: [3, 5] },
      },
    },
  };
}

function bottleneck() {
  return {
    key: 'capacity-bottleneck',
    name: 'Capacity bottleneck',
    description:
      'Six identical shipments A->C released at hour 0 must all pass through A-B, which accepts one movement per hour. B-C has spare capacity. The shipments leave one per hour, so only the first four meet the deadline of hour 6.',
    network: {
      terminals: [t('A', 'Terminal A', 10, 32), t('B', 'Terminal B', 50, 32), t('C', 'Terminal C', 90, 32)],
      connections: [c('AB', 'A', 'B', 2, 1), c('BC', 'B', 'C', 1, 2)],
    },
    shipments: [1, 2, 3, 4, 5, 6].map((n) => s(`S${n}`, 'A', 'C', 0, 6)),
    disruptions: [],
    expected: {
      notes: 'S(n) leaves A at hour n-1, reaches B at n+1 and C at n+2. Arrivals 3,4,5,6 (on time) and 7,8 (late by 1 and 2 hours).',
      shipments: {
        S1: { status: 'on_time', arrival: 3, departures: [0, 2] },
        S2: { status: 'on_time', arrival: 4, departures: [1, 3] },
        S3: { status: 'on_time', arrival: 5, departures: [2, 4] },
        S4: { status: 'on_time', arrival: 6, departures: [3, 5] },
        S5: { status: 'late', arrival: 7, departures: [4, 6] },
        S6: { status: 'late', arrival: 8, departures: [5, 7] },
      },
    },
  };
}

function closureScenario() {
  return {
    key: 'connection-closure',
    name: 'Connection closure',
    description:
      'The diamond network with A-B closed during hours [0, 6). Shipments are rerouted through C; the A->B shipment has to wait until the closure ends (a movement may depart exactly when the closure ends).',
    network: diamondNetwork(),
    shipments: [s('S1', 'A', 'D', 0, 8), s('S2', 'A', 'D', 0, 8), s('S3', 'A', 'D', 0, 8), s('S4', 'A', 'B', 0, 9)],
    disruptions: [{ id: 'D1', type: DISRUPTION.CLOSURE, connectionId: 'AB', startHour: 0, endHour: 6, note: 'Track maintenance on A-B' }],
    expected: {
      notes: 'S4 has the least slack so it is scheduled first: AB cannot be entered before hour 6, so it departs at 6 and arrives at 8. S1 and S2 use AC@0, CD@3 (arrive 6). S3 finds AC slot 0 full and uses AC@1, CD@4 (arrives 7).',
      shipments: {
        S1: { status: 'on_time', arrival: 6, route: ['AC', 'CD'], departures: [0, 3] },
        S2: { status: 'on_time', arrival: 6, route: ['AC', 'CD'], departures: [0, 3] },
        S3: { status: 'on_time', arrival: 7, route: ['AC', 'CD'], departures: [1, 4] },
        S4: { status: 'on_time', arrival: 8, route: ['AB'], departures: [6] },
      },
    },
  };
}

function disconnected() {
  return {
    key: 'disconnected-network',
    name: 'Disconnected network',
    description:
      'Two islands: A-B and C-D. Shipments inside an island are delivered; shipments between islands cannot be routed and are reported as undeliverable with the reason "disconnected".',
    network: {
      terminals: [t('A', 'Terminal A', 10, 12), t('B', 'Terminal B', 40, 12), t('C', 'Terminal C', 60, 52), t('D', 'Terminal D', 90, 52)],
      connections: [c('AB', 'A', 'B', 2, 2), c('CD', 'C', 'D', 2, 2)],
    },
    shipments: [s('S1', 'A', 'B', 0, 6), s('S2', 'C', 'D', 1, 6), s('S3', 'A', 'D', 0, 20), s('S4', 'B', 'C', 4, 20)],
    disruptions: [],
    expected: {
      notes: 'S1 arrives at 2 and S2 at 3. S3 and S4 have no path at all.',
      shipments: {
        S1: { status: 'on_time', arrival: 2, route: ['AB'] },
        S2: { status: 'on_time', arrival: 3, route: ['CD'] },
        S3: { status: 'undeliverable' },
        S4: { status: 'undeliverable' },
      },
    },
  };
}

function conflictingDeadlines() {
  return {
    key: 'conflicting-deadlines',
    name: 'Conflicting delivery deadlines',
    description:
      'Five shipments A->C released at hour 8 share the one-per-hour A-B-C corridor and all want delivery by hour 11, but only two can make it. Priority decides who wins: critical first, then high, then the standard shipments in id order, then low.',
    network: {
      terminals: [t('A', 'Terminal A', 10, 32), t('B', 'Terminal B', 50, 32), t('C', 'Terminal C', 90, 32)],
      connections: [c('AB', 'A', 'B', 1, 1), c('BC', 'B', 'C', 1, 1)],
    },
    shipments: [
      s('S1', 'A', 'C', 8, 11, 1),
      s('S2', 'A', 'C', 8, 11, 2),
      s('S3', 'A', 'C', 8, 11, 3),
      s('S4', 'A', 'C', 8, 11, 4),
      s('S5', 'A', 'C', 8, 11, 2),
    ],
    disruptions: [],
    expected: {
      notes: 'Arrival slots are 10, 11, 12, 13, 14. S4 (critical) gets 10, S3 (high) 11, S2 and S5 (standard, id order) 12 and 13, S1 (low) 14. Three are late.',
      shipments: {
        S4: { status: 'on_time', arrival: 10 },
        S3: { status: 'on_time', arrival: 11 },
        S2: { status: 'late', arrival: 12 },
        S5: { status: 'late', arrival: 13 },
        S1: { status: 'late', arrival: 14 },
      },
    },
  };
}

/** The seeded default network with one disruption of each kind, as a ready-made what-if. */
function disruptedBaseline(baseline) {
  const busiest = baseline.network.connections[2].id; // T1-T4, the western gateway to the hub
  const shipmentIds = baseline.shipments.slice(0, 3).map((x) => x.id);
  return {
    key: 'disrupted-baseline',
    name: 'Baseline + disruptions (demo)',
    description:
      'The seeded 8-terminal network with a closure, a travel-time increase, a capacity cut and three delayed releases. Compare it against the baseline to see rerouted, late and undeliverable shipments.',
    network: structuredClone(baseline.network),
    shipments: structuredClone(baseline.shipments),
    disruptions: [
      { id: 'D1', type: DISRUPTION.CLOSURE, connectionId: busiest, startHour: 0, endHour: 30, note: 'Landslide on the western gateway' },
      { id: 'D2', type: DISRUPTION.TRAVEL_TIME, connectionId: 'C07', startHour: 20, endHour: 60, extraHours: 3, note: 'Speed restriction' },
      { id: 'D3', type: DISRUPTION.CAPACITY, connectionId: 'C12', startHour: 0, endHour: 80, capacity: 1, note: 'Signalling fault' },
      ...shipmentIds.map((id, i) => ({ id: `D${4 + i}`, type: DISRUPTION.RELEASE_DELAY, shipmentId: id, delayHours: 6 + i * 3 })),
    ],
    expected: null,
  };
}

export function listPresets(baseline) {
  return [threeTerminal(), normalRouting(), bottleneck(), closureScenario(), disconnected(), conflictingDeadlines(), disruptedBaseline(baseline)];
}

/** Build a fresh generated scenario body from a seed (used by the "Generate from seed" tool). */
export function generatedScenarioBody(seed, shipmentCount) {
  const { terminals, connections, shipments } = generateNetwork(seed, shipmentCount);
  return { network: { terminals, connections }, shipments, disruptions: [] };
}
