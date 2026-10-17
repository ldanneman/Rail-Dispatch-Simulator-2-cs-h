// Shared constants for the scheduling engine.
// All times are integer hours relative to a common start (hour 0).
// Intervals are half-open: [start, end).

export const HORIZON_HOURS = 168; // seven-day planning horizon: slots 0..167, arrivals <= 168
export const MAX_REFINEMENT_PASSES = 6;

export const STATUS = Object.freeze({
  ON_TIME: 'on_time',
  LATE: 'late',
  UNDELIVERABLE: 'undeliverable',
});

export const PRIORITIES = Object.freeze([
  { value: 4, label: 'Critical' },
  { value: 3, label: 'High' },
  { value: 2, label: 'Standard' },
  { value: 1, label: 'Low' },
]);

// Weight used by the refinement objective: a critical shipment counts 8x a low one.
export const PRIORITY_WEIGHT = Object.freeze({ 1: 1, 2: 2, 3: 4, 4: 8 });

export const DISRUPTION = Object.freeze({
  CLOSURE: 'closure',
  TRAVEL_TIME: 'travel_time',
  CAPACITY: 'capacity',
  RELEASE_DELAY: 'release_delay',
});

export const FAILURE = Object.freeze({
  INVALID_REFERENCE: 'invalid_reference',
  RELEASE_BEYOND_HORIZON: 'release_beyond_horizon',
  DISCONNECTED: 'disconnected',
  TRANSIT_EXCEEDS_HORIZON: 'transit_exceeds_horizon',
  DISRUPTION_BLOCKED: 'disruption_blocked',
  CAPACITY_EXHAUSTED: 'capacity_exhausted',
});

export const LATE_CAUSE = Object.freeze({
  DEADLINE_INFEASIBLE: 'deadline_infeasible', // misses even with free-flow, undisrupted transit
  DISRUPTION: 'disruption', // would be on time without disruptions
  CONGESTION: 'congestion', // would be on time if capacity were unlimited
});

export const PRIORITY_LABEL = Object.freeze(
  Object.fromEntries(PRIORITIES.map((p) => [p.value, p.label])),
);

export const LIMITS = Object.freeze({
  terminals: 40,
  connections: 200,
  shipments: 1000,
  disruptions: 200,
  maxHour: 10000,
  maxTravelTime: 1000,
  maxCapacity: 1000,
});
