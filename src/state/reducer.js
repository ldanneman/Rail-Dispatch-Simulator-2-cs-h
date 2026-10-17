import { runSchedule } from '../engine/scheduler.js';
import { checkRecord, validateScenarioBody } from '../data/validation.js';
import { BASELINE_ID, MAX_SCENARIOS, allocateId, bodyOf, computeCounters, engineInput, getBaseline, makeScenario } from './scenarioModel.js';
import * as edits from './edits.js';

export const DEFAULT_SETTINGS = Object.freeze({ autoRecalc: true });

/*
 * Application state (pure data, reducer-driven):
 *   scenarios            editable scenarios (the immutable baseline is NOT stored here)
 *   activeId             scenario shown by the dashboard pages and edited in the Test Lab
 *   settings             { autoRecalc }
 *   nextScenarioNumber   monotonic counter for scenario ids
 *   runs                 { [scenarioId]: { rev, input, result } } - latest schedule per scenario (not persisted)
 *   notices              transient messages for the UI (not persisted)
 * A run is "stale" when runs[id].rev !== scenario.rev (inputs edited since the last run).
 */

/** A run keeps the exact input it was computed from, so results are never shown against edited inputs. */
export function computeRun(scenario) {
  const input = engineInput(scenario);
  return { rev: scenario.rev, input, result: runSchedule(input) };
}

export function createInitialState(persisted = null, notices = []) {
  const baseline = getBaseline();
  const scenarios = persisted?.scenarios ?? [];
  const runs = { [BASELINE_ID]: computeRun(baseline) };
  const failedRuns = [];
  for (const s of scenarios) {
    try {
      runs[s.id] = computeRun(s);
    } catch (e) {
      failedRuns.push(`${s.name}: ${e.message}`);
    }
  }
  const activeId = persisted && [BASELINE_ID, ...scenarios.map((s) => s.id)].includes(persisted.activeId) ? persisted.activeId : BASELINE_ID;
  let state = {
    scenarios,
    activeId,
    settings: { ...DEFAULT_SETTINGS, ...(persisted?.settings ?? {}) },
    nextScenarioNumber: persisted?.nextScenarioNumber ?? 1,
    runs,
    notices: [],
    nextNoticeId: 1,
  };
  for (const n of notices) state = notify(state, n.level, n.text);
  for (const f of failedRuns) state = notify(state, 'error', `Could not schedule ${f}`);
  return state;
}

export function getScenario(state, id) {
  if (id === BASELINE_ID) return getBaseline();
  return state.scenarios.find((s) => s.id === id) ?? null;
}

export const listScenarios = (state) => [getBaseline(), ...state.scenarios];
export const isStale = (state, id) => {
  const s = getScenario(state, id);
  return !s || !state.runs[id] || state.runs[id].rev !== s.rev;
};

function notify(state, level, text) {
  const notices = [...state.notices, { id: state.nextNoticeId, level, text }].slice(-4);
  return { ...state, notices, nextNoticeId: state.nextNoticeId + 1 };
}

function uniqueName(base, scenarios) {
  const names = new Set([getBaseline().name, ...scenarios.map((s) => s.name)]);
  if (!names.has(base)) return base;
  let n = 2;
  while (names.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

function addScenario(state, { name, description, source, parentId, body, expected, select = true }) {
  if (state.scenarios.length >= MAX_SCENARIOS) {
    return notify(state, 'error', `At most ${MAX_SCENARIOS} custom scenarios can be kept. Delete one first.`);
  }
  const check = validateScenarioBody({ ...body, expected });
  if (!check.ok) return notify(state, 'error', `Scenario rejected: ${check.errors[0].path} ${check.errors[0].message}`);
  const id = `sc-${state.nextScenarioNumber}`;
  const scenario = makeScenario({
    id,
    name: uniqueName(name, state.scenarios),
    description,
    source,
    parentId,
    body: check.value,
    expected: check.value.expected ?? null,
  });
  let next = { ...state, scenarios: [...state.scenarios, scenario], nextScenarioNumber: state.nextScenarioNumber + 1 };
  try {
    next = { ...next, runs: { ...next.runs, [id]: computeRun(scenario) } };
  } catch (e) {
    next = notify(next, 'error', `Scheduling failed: ${e.message}`);
  }
  if (select) next = { ...next, activeId: id };
  return next;
}

/** Replace one user scenario via `fn(scenario) -> fields`; bumps rev and recalculates when auto-recalc is on. */
function editScenario(state, id, fn) {
  if (id === BASELINE_ID) return notify(state, 'error', 'The baseline is read-only. Fork it to make changes.');
  const current = state.scenarios.find((s) => s.id === id);
  if (!current) return notify(state, 'error', 'That scenario no longer exists.');
  const fields = fn(current);
  if (fields === null) return state;
  const updated = { ...current, ...fields, rev: current.rev + 1 };
  let next = { ...state, scenarios: state.scenarios.map((s) => (s.id === id ? updated : s)) };
  if (state.settings.autoRecalc) {
    try {
      next = { ...next, runs: { ...next.runs, [id]: computeRun(updated) } };
    } catch (e) {
      next = notify(next, 'error', `Scheduling failed: ${e.message}`);
    }
  }
  return next;
}

const fail = (state, messages) => notify(state, 'error', messages[0]);

function upsertRecord(state, { scenarioId, kind, record }) {
  const scenario = getScenario(state, scenarioId);
  if (!scenario) return notify(state, 'error', 'That scenario no longer exists.');
  if (scenario.locked) return notify(state, 'error', 'The baseline is read-only. Fork it to make changes.');
  let counters = scenario.counters;
  let rec = { ...record };
  let editingId = null;
  if (rec.id) {
    editingId = rec.id;
    const exists = {
      terminal: scenario.network.terminals,
      connection: scenario.network.connections,
      shipment: scenario.shipments,
      disruption: scenario.disruptions,
    }[kind].some((x) => x.id === rec.id);
    if (!exists) editingId = null; // caller supplied a fresh id
  } else {
    const alloc = allocateId(scenario, kind);
    rec.id = alloc.id;
    counters = alloc.counters;
  }
  const checked = checkRecord(kind, rec, scenario, { editingId });
  if (checked.errors.length) return fail(state, checked.errors);
  rec = checked.record;
  return editScenario(state, scenarioId, (s) => {
    const body = bodyOf(s);
    const merged =
      kind === 'terminal' ? edits.upsertTerminal(body, rec)
      : kind === 'connection' ? edits.upsertConnection(body, rec)
      : kind === 'shipment' ? edits.upsertShipment(body, rec)
      : edits.upsertDisruption(body, rec);
    return { ...merged, counters };
  });
}

function removeRecord(state, { scenarioId, kind, id }) {
  return editScenario(state, scenarioId, (s) => {
    const body = bodyOf(s);
    if (kind === 'terminal') return edits.removeTerminal(body, id).body;
    if (kind === 'connection') return edits.removeConnection(body, id).body;
    if (kind === 'shipment') return edits.removeShipment(body, id).body;
    return edits.removeDisruption(body, id);
  });
}

export function reducer(state, action) {
  switch (action.type) {
    case 'scenario/create':
      return addScenario(state, action);

    case 'scenario/fork': {
      const source = getScenario(state, action.sourceId);
      if (!source) return notify(state, 'error', 'Cannot fork: scenario not found.');
      return addScenario(state, {
        name: action.name || `${source.name} (fork)`,
        description: action.description ?? `Forked from "${source.name}".`,
        source: 'fork',
        parentId: source.id,
        body: bodyOf(source),
        expected: source.expected,
      });
    }

    case 'scenario/select':
      return getScenario(state, action.id) ? { ...state, activeId: action.id } : state;

    case 'scenario/rename': {
      if (action.id === BASELINE_ID) return notify(state, 'error', 'The baseline cannot be renamed.');
      const name = String(action.name ?? '').trim().slice(0, 60);
      if (!name) return notify(state, 'error', 'A scenario needs a name.');
      return {
        ...state,
        scenarios: state.scenarios.map((s) =>
          s.id === action.id
            ? { ...s, name, description: action.description !== undefined ? String(action.description).slice(0, 500) : s.description }
            : s,
        ),
      };
    }

    case 'scenario/delete': {
      if (action.id === BASELINE_ID) return notify(state, 'error', 'The baseline cannot be deleted.');
      const target = state.scenarios.find((s) => s.id === action.id);
      if (!target) return state;
      const runs = { ...state.runs };
      delete runs[action.id];
      return {
        ...state,
        scenarios: state.scenarios.filter((s) => s.id !== action.id).map((s) => (s.parentId === action.id ? { ...s, parentId: target.parentId } : s)),
        activeId: state.activeId === action.id ? BASELINE_ID : state.activeId,
        runs,
      };
    }

    case 'scenario/reset':
      return editScenario(state, action.id, (s) => ({
        ...structuredClone({
          network: s.origin.network,
          shipments: s.origin.shipments,
          disruptions: s.origin.disruptions,
          expected: s.origin.expected ?? null,
        }),
        counters: computeCounters(s.origin),
      }));

    case 'scenario/run': {
      const scenario = getScenario(state, action.id);
      if (!scenario) return state;
      try {
        return { ...state, runs: { ...state.runs, [action.id]: computeRun(scenario) } };
      } catch (e) {
        return notify(state, 'error', `Scheduling failed: ${e.message}`);
      }
    }

    case 'scenario/applySections': {
      // action.body: { network?, shipments?, disruptions?, expected? } already validated section-wise;
      // the merged result is validated again so cross references stay consistent.
      const scenario = getScenario(state, action.id);
      if (!scenario || scenario.locked) return notify(state, 'error', 'The baseline is read-only. Fork it to make changes.');
      const merged = {
        network: action.body.network ?? scenario.network,
        shipments: action.body.shipments ?? scenario.shipments,
        disruptions: action.body.disruptions ?? scenario.disruptions,
        expected: action.body.expected !== undefined ? action.body.expected : scenario.expected,
      };
      const check = validateScenarioBody(merged);
      if (!check.ok) return fail(state, check.errors.map((e) => `Import rejected: ${e.path} ${e.message}`));
      return editScenario(state, action.id, () => ({
        network: check.value.network,
        shipments: check.value.shipments,
        disruptions: check.value.disruptions,
        expected: check.value.expected ?? null,
        counters: computeCounters(check.value),
      }));
    }

    case 'record/upsert':
      return upsertRecord(state, action);

    case 'record/remove':
      return removeRecord(state, action);

    case 'settings/update':
      return { ...state, settings: { ...state.settings, ...action.settings } };

    case 'workspace/reset':
      return notify(createInitialState(null), 'info', 'Workspace reset to the original seeded state.');

    case 'notice/push':
      return notify(state, action.level ?? 'info', action.text);

    case 'notice/dismiss':
      return { ...state, notices: state.notices.filter((n) => n.id !== action.id) };

    default:
      return state;
  }
}
