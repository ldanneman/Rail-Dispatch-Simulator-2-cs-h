import { validateScenarioBody } from '../data/validation.js';
import { BASELINE_ID, MAX_SCENARIOS, computeCounters, makeScenario } from './scenarioModel.js';
import { DEFAULT_SETTINGS } from './reducer.js';

export const STORAGE_KEY = 'rail-dispatch-simulator:v1';
export const STORAGE_VERSION = 1;

/** Only the editable, user-owned data is persisted. The baseline is regenerated from its seed. */
export function serializeState(state) {
  return {
    version: STORAGE_VERSION,
    activeId: state.activeId,
    settings: state.settings,
    nextScenarioNumber: state.nextScenarioNumber,
    scenarios: state.scenarios.map((s) => ({
      id: s.id,
      name: s.name,
      description: s.description,
      source: s.source,
      parentId: s.parentId,
      rev: s.rev,
      network: s.network,
      shipments: s.shipments,
      disruptions: s.disruptions,
      expected: s.expected,
      counters: s.counters,
      origin: s.origin,
    })),
  };
}

export function saveState(state, storage = globalThis.localStorage) {
  try {
    storage.setItem(STORAGE_KEY, JSON.stringify(serializeState(state)));
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e?.name === 'QuotaExceededError' ? 'Browser storage is full' : (e?.message ?? 'Browser storage is unavailable') };
  }
}

export function clearSavedState(storage = globalThis.localStorage) {
  try {
    storage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable: nothing to clear */
  }
}

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Read and validate saved state. Never throws: unreadable or invalid data is dropped and
 * reported through `notices`. Each scenario body is validated with the same rules as an import.
 * Returns { persisted: {scenarios, activeId, settings, nextScenarioNumber} | null, notices }.
 */
export function loadState(storage = globalThis.localStorage) {
  const notices = [];
  let raw;
  try {
    raw = storage.getItem(STORAGE_KEY);
  } catch {
    return { persisted: null, notices: [{ level: 'warning', text: 'Browser storage is unavailable; changes will not persist after a reload.' }] };
  }
  if (raw === null || raw === undefined) return { persisted: null, notices };

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    return { persisted: null, notices: [{ level: 'warning', text: 'Saved data was corrupted and has been discarded. Starting from the seeded baseline.' }] };
  }
  if (!isObject(data) || data.version !== STORAGE_VERSION || !Array.isArray(data.scenarios)) {
    return { persisted: null, notices: [{ level: 'warning', text: 'Saved data has an unsupported format and has been discarded.' }] };
  }

  const scenarios = [];
  const seen = new Set();
  data.scenarios.slice(0, MAX_SCENARIOS).forEach((s, i) => {
    const label = isObject(s) && typeof s.name === 'string' ? `"${s.name}"` : `#${i + 1}`;
    if (!isObject(s) || typeof s.id !== 'string' || !/^sc-\d+$/.test(s.id) || s.id === BASELINE_ID || seen.has(s.id)) {
      notices.push({ level: 'warning', text: `Saved scenario ${label} had an invalid id and was dropped.` });
      return;
    }
    const check = validateScenarioBody({ network: s.network, shipments: s.shipments, disruptions: s.disruptions, expected: s.expected });
    if (!check.ok || typeof s.name !== 'string' || !s.name.trim()) {
      notices.push({ level: 'warning', text: `Saved scenario ${label} failed validation (${check.errors[0]?.path ?? 'name'}) and was dropped.` });
      return;
    }
    // The reset snapshot is optional data; fall back to the current inputs if it is unusable.
    let origin = null;
    if (isObject(s.origin)) {
      const o = validateScenarioBody(s.origin);
      if (o.ok) origin = { network: o.value.network, shipments: o.value.shipments, disruptions: o.value.disruptions, expected: o.value.expected ?? null };
    }
    const scenario = makeScenario({
      id: s.id,
      name: s.name.trim().slice(0, 60),
      description: typeof s.description === 'string' ? s.description.slice(0, 500) : '',
      source: typeof s.source === 'string' ? s.source : 'custom',
      parentId: typeof s.parentId === 'string' ? s.parentId : null,
      body: check.value,
      expected: check.value.expected ?? null,
      origin: origin ?? undefined,
    });
    // Counters never go backwards, so ids deleted before the reload are not reused.
    const computed = computeCounters(scenario);
    const stored = isObject(s.counters) ? s.counters : {};
    scenario.counters = Object.fromEntries(
      Object.keys(computed).map((k) => [k, Math.max(computed[k], Number.isInteger(stored[k]) ? stored[k] : 0)]),
    );
    scenario.rev = Number.isInteger(s.rev) && s.rev >= 0 ? s.rev : 0;
    seen.add(s.id);
    scenarios.push(scenario);
  });

  const ids = new Set(scenarios.map((s) => s.id));
  for (const s of scenarios) if (s.parentId && s.parentId !== BASELINE_ID && !ids.has(s.parentId)) s.parentId = null;
  const maxNumber = scenarios.reduce((m, s) => Math.max(m, Number(s.id.slice(3))), 0);
  const settings = isObject(data.settings) ? { ...DEFAULT_SETTINGS, autoRecalc: data.settings.autoRecalc !== false } : { ...DEFAULT_SETTINGS };
  return {
    persisted: {
      scenarios,
      activeId: typeof data.activeId === 'string' ? data.activeId : BASELINE_ID,
      settings,
      nextScenarioNumber: Math.max(Number.isInteger(data.nextScenarioNumber) ? data.nextScenarioNumber : 1, maxNumber + 1),
    },
    notices,
  };
}
