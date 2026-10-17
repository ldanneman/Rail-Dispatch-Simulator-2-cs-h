import { beforeEach, describe, expect, it } from 'vitest';
import { compareShipments, compareMetrics, runSchedule, verifySchedule } from '../../src/engine/index.js';
import { listPresets } from '../../src/data/presets.js';
import { generatedScenarioBody } from '../../src/data/presets.js';
import { createInitialState, getScenario, isStale, reducer } from '../../src/state/reducer.js';
import { BASELINE_ID, engineInput, getBaseline } from '../../src/state/scenarioModel.js';
import { STORAGE_KEY, clearSavedState, loadState, saveState, serializeState } from '../../src/state/persistence.js';
import { previewRemoval } from '../../src/state/edits.js';

const baseline = getBaseline();
const baselineSnapshot = JSON.stringify(baseline);
const dispatch = (state, ...actions) => actions.reduce(reducer, state);
const fork = (state, name = 'Test fork') => reducer(state, { type: 'scenario/fork', sourceId: BASELINE_ID, name });
const lastScenario = (state) => state.scenarios[state.scenarios.length - 1];

function memoryStorage() {
  const map = new Map();
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    _map: map,
  };
}

describe('baseline immutability', () => {
  it('is frozen and unchanged by every operation', () => {
    expect(Object.isFrozen(baseline)).toBe(true);
    expect(Object.isFrozen(baseline.shipments[0])).toBe(true);
    expect(() => { 'use strict'; baseline.shipments[0].priority = 4; }).toThrow();
    let s = createInitialState();
    const baselineRun = JSON.stringify(s.runs[BASELINE_ID].result);
    s = fork(s);
    const id = lastScenario(s).id;
    s = dispatch(
      s,
      { type: 'record/upsert', scenarioId: id, kind: 'shipment', record: { origin: 'T1', destination: 'T7', release: 0, deadline: 40, priority: 4 } },
      { type: 'record/remove', scenarioId: id, kind: 'terminal', id: 'T4' },
      { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'closure', connectionId: 'C01', startHour: 0, endHour: 50 } },
      { type: 'scenario/run', id },
      { type: 'scenario/reset', id },
    );
    expect(JSON.stringify(baseline)).toBe(baselineSnapshot);
    expect(JSON.stringify(s.runs[BASELINE_ID].result)).toBe(baselineRun);
  });

  it('rejects edits, renames and deletion of the baseline with a notice', () => {
    let s = createInitialState();
    for (const action of [
      { type: 'record/upsert', scenarioId: BASELINE_ID, kind: 'shipment', record: { origin: 'T1', destination: 'T2', release: 0, deadline: 9, priority: 1 } },
      { type: 'record/remove', scenarioId: BASELINE_ID, kind: 'shipment', id: 'S001' },
      { type: 'scenario/rename', id: BASELINE_ID, name: 'x' },
      { type: 'scenario/delete', id: BASELINE_ID },
      { type: 'scenario/reset', id: BASELINE_ID },
    ]) {
      const before = s.nextNoticeId;
      s = reducer(s, action);
      expect(s.nextNoticeId).toBe(before + 1); // exactly one new notice
      expect(s.notices.at(-1).level).toBe('error');
    }
    expect(s.scenarios).toEqual([]);
    expect(JSON.stringify(baseline)).toBe(baselineSnapshot);
  });
});

describe('scenario lifecycle', () => {
  it('forks with a deep copy and runs it immediately', () => {
    let s = fork(createInitialState());
    const f = lastScenario(s);
    expect(s.activeId).toBe(f.id);
    expect(f.parentId).toBe(BASELINE_ID);
    expect(f.shipments).toEqual(baseline.shipments);
    expect(f.shipments).not.toBe(baseline.shipments);
    expect(s.runs[f.id].result).toEqual(s.runs[BASELINE_ID].result);
    expect(isStale(s, f.id)).toBe(false);
  });

  it('gives forks unique names and limits the number of scenarios', () => {
    let s = createInitialState();
    for (let i = 0; i < 3; i++) s = fork(s, 'Same');
    expect(new Set(s.scenarios.map((x) => x.name)).size).toBe(3);
    for (let i = 0; i < 40; i++) s = fork(s, `S${i}`);
    expect(s.scenarios.length).toBeLessThanOrEqual(25);
    expect(s.notices.at(-1).text).toMatch(/At most 25/);
  });

  it('allocates monotonic ids that are never reused after deletion', () => {
    let s = fork(createInitialState());
    const id = lastScenario(s).id;
    const add = () => dispatch(s, { type: 'record/upsert', scenarioId: id, kind: 'shipment', record: { origin: 'T1', destination: 'T2', release: 1, deadline: 30, priority: 2 } });
    s = add();
    const first = lastScenario(s).shipments.at(-1).id;
    expect(first).toBe('S101');
    s = dispatch(s, { type: 'record/remove', scenarioId: id, kind: 'shipment', id: first });
    s = add();
    expect(lastScenario(s).shipments.at(-1).id).toBe('S102');
  });

  it('recalculates automatically by default and goes stale when auto-recalc is off', () => {
    let s = fork(createInitialState());
    const id = lastScenario(s).id;
    const edit = { type: 'record/upsert', scenarioId: id, kind: 'shipment', record: { id: 'S001', origin: 'T1', destination: 'T7', release: 3, deadline: 9, priority: 4 } };
    s = reducer(s, edit);
    expect(isStale(s, id)).toBe(false);
    s = dispatch(s, { type: 'settings/update', settings: { autoRecalc: false } }, { ...edit, record: { ...edit.record, release: 4 } });
    expect(isStale(s, id)).toBe(true);
    const staleResult = s.runs[id].result;
    s = reducer(s, { type: 'scenario/run', id });
    expect(isStale(s, id)).toBe(false);
    expect(s.runs[id].result).not.toBe(staleResult);
    expect(s.runs[id].result.shipments.find((x) => x.id === 'S001').effectiveRelease).toBe(4);
  });

  it('reset restores the creation snapshot', () => {
    let s = fork(createInitialState());
    const id = lastScenario(s).id;
    s = dispatch(
      s,
      { type: 'record/remove', scenarioId: id, kind: 'shipment', id: 'S001' },
      { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'closure', connectionId: 'C03', startHour: 0, endHour: 40 } },
    );
    expect(getScenario(s, id).shipments).toHaveLength(99);
    s = reducer(s, { type: 'scenario/reset', id });
    expect(getScenario(s, id).shipments).toEqual(baseline.shipments);
    expect(getScenario(s, id).disruptions).toEqual([]);
    expect(s.runs[id].result).toEqual(s.runs[BASELINE_ID].result);
  });

  it('delete re-parents children and falls back to the baseline selection', () => {
    let s = fork(createInitialState(), 'A');
    const a = lastScenario(s).id;
    s = reducer(s, { type: 'scenario/fork', sourceId: a, name: 'B' });
    const b = lastScenario(s).id;
    expect(getScenario(s, b).parentId).toBe(a);
    s = reducer(s, { type: 'scenario/delete', id: a });
    expect(getScenario(s, b).parentId).toBe(BASELINE_ID);
    expect(s.runs[a]).toBeUndefined();
    s = reducer(s, { type: 'scenario/delete', id: b });
    expect(s.activeId).toBe(BASELINE_ID);
  });

  it('workspace reset returns to the seeded state', () => {
    let s = dispatch(createInitialState(), { type: 'scenario/fork', sourceId: BASELINE_ID }, { type: 'settings/update', settings: { autoRecalc: false } });
    s = reducer(s, { type: 'workspace/reset' });
    expect(s.scenarios).toEqual([]);
    expect(s.activeId).toBe(BASELINE_ID);
    expect(s.settings.autoRecalc).toBe(true);
    expect(s.nextScenarioNumber).toBe(1);
  });

  it('creates scenarios from presets and generated seeds, refusing invalid bodies', () => {
    let s = createInitialState();
    const ref = listPresets(baseline)[0];
    s = reducer(s, { type: 'scenario/create', name: ref.name, source: 'preset', body: ref, expected: ref.expected });
    const sc = lastScenario(s);
    expect(s.runs[sc.id].result.shipments.map((x) => x.arrival)).toEqual([10, 11, 12]);
    s = reducer(s, { type: 'scenario/create', name: 'Gen', source: 'generated', body: generatedScenarioBody(77, 30) });
    expect(lastScenario(s).shipments).toHaveLength(30);
    const before = s.scenarios.length;
    s = reducer(s, { type: 'scenario/create', name: 'Bad', source: 'import', body: { network: { terminals: [], connections: [{ id: 'X', from: 'A', to: 'B', travelTime: 1, capacity: 1 }] }, shipments: [], disruptions: [] } });
    expect(s.scenarios).toHaveLength(before);
    expect(s.notices.at(-1).text).toMatch(/rejected/);
  });
});

describe('editing keeps relationships consistent', () => {
  const setup = () => {
    let s = fork(createInitialState());
    return { s, id: lastScenario(s).id };
  };

  it('removing a terminal cascades to connections, shipments and disruptions', () => {
    let { s, id } = setup();
    s = reducer(s, { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'closure', connectionId: 'C03', startHour: 0, endHour: 10 } });
    const sc = getScenario(s, id);
    const preview = previewRemoval({ network: sc.network, shipments: sc.shipments, disruptions: sc.disruptions }, 'terminal', 'T1');
    s = reducer(s, { type: 'record/remove', scenarioId: id, kind: 'terminal', id: 'T1' });
    const after = getScenario(s, id);
    expect(after.network.terminals.some((t) => t.id === 'T1')).toBe(false);
    expect(after.network.connections.some((c) => c.from === 'T1' || c.to === 'T1')).toBe(false);
    expect(after.shipments.some((x) => x.origin === 'T1' || x.destination === 'T1')).toBe(false);
    expect(after.disruptions).toEqual([]);
    expect(preview.connections).toBe(3);
    expect(preview.disruptions).toBe(1);
    expect(sc.shipments.length - after.shipments.length).toBe(preview.shipments);
    expect(verifySchedule(engineInput(after), s.runs[id].result).ok).toBe(true);
  });

  it('removing a connection or a shipment removes dependent disruptions', () => {
    let { s, id } = setup();
    s = dispatch(
      s,
      { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'capacity', connectionId: 'C05', startHour: 0, endHour: 10, capacity: 0 } },
      { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'release_delay', shipmentId: 'S005', delayHours: 3 } },
    );
    expect(getScenario(s, id).disruptions).toHaveLength(2);
    s = reducer(s, { type: 'record/remove', scenarioId: id, kind: 'connection', id: 'C05' });
    expect(getScenario(s, id).disruptions).toHaveLength(1);
    s = reducer(s, { type: 'record/remove', scenarioId: id, kind: 'shipment', id: 'S005' });
    expect(getScenario(s, id).disruptions).toHaveLength(0);
  });

  it('rejects invalid edits with a notice and leaves the scenario untouched', () => {
    let { s, id } = setup();
    const before = JSON.stringify(getScenario(s, id));
    const bad = [
      { kind: 'shipment', record: { origin: 'T1', destination: 'T1', release: 0, deadline: 9, priority: 2 } },
      { kind: 'shipment', record: { origin: 'T1', destination: 'T2', release: 9, deadline: 3, priority: 2 } },
      { kind: 'shipment', record: { origin: 'T1', destination: 'NOPE', release: 0, deadline: 9, priority: 2 } },
      { kind: 'connection', record: { from: 'T1', to: 'T2', travelTime: 0, capacity: 1 } },
      { kind: 'connection', record: { from: 'T1', to: 'T2', travelTime: 1, capacity: 1.5 } },
      { kind: 'disruption', record: { type: 'closure', connectionId: 'C01', startHour: 9, endHour: 9 } },
      { kind: 'terminal', record: { id: 'T1', name: '' } },
    ];
    for (const b of bad) {
      const n = s.nextNoticeId;
      s = reducer(s, { type: 'record/upsert', scenarioId: id, ...b });
      expect(s.nextNoticeId, JSON.stringify(b)).toBe(n + 1);
      expect(JSON.stringify(getScenario(s, id))).toBe(before);
    }
  });

  it('editing a connection changes the schedule through the real engine', () => {
    let { s, id } = setup();
    const c = getScenario(s, id).network.connections.find((x) => x.id === 'C03');
    s = reducer(s, { type: 'record/upsert', scenarioId: id, kind: 'connection', record: { ...c, travelTime: c.travelTime + 5, capacity: 1 } });
    expect(getScenario(s, id).network.connections.find((x) => x.id === 'C03').travelTime).toBe(c.travelTime + 5);
    expect(s.runs[id].result).not.toEqual(s.runs[BASELINE_ID].result);
  });

  it('applySections merges only the chosen sections and validates cross references', () => {
    let { s, id } = setup();
    const ref = listPresets(baseline)[0];
    // Replacing only the shipments with ones that reference unknown terminals must fail.
    const before = JSON.stringify(getScenario(s, id));
    s = reducer(s, { type: 'scenario/applySections', id, body: { shipments: ref.shipments } });
    expect(s.notices.at(-1).text).toMatch(/Import rejected/);
    expect(JSON.stringify(getScenario(s, id))).toBe(before);
    s = reducer(s, { type: 'scenario/applySections', id, body: { network: ref.network, shipments: ref.shipments, disruptions: [] } });
    expect(getScenario(s, id).shipments).toHaveLength(3);
    expect(s.runs[id].result.shipments.map((x) => x.arrival)).toEqual([10, 11, 12]);
  });
});

describe('scenario comparison and replanning', () => {
  it('a disruption scenario differs from the baseline while the baseline result is unchanged', () => {
    let s = fork(createInitialState());
    const id = lastScenario(s).id;
    const baseRun = JSON.stringify(s.runs[BASELINE_ID].result);
    s = reducer(s, { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'closure', connectionId: 'C03', startHour: 0, endHour: 60 } });
    s = reducer(s, { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'release_delay', shipmentId: 'S001', delayHours: 10 } });
    const diff = compareShipments(s.runs[BASELINE_ID].result, s.runs[id].result);
    expect(diff.summary.affected).toBeGreaterThan(0);
    expect(diff.summary.releaseDelayed).toBe(1);
    expect(diff.rows.find((r) => r.id === 'S001').flags).toContain('release_delayed');
    const metrics = compareMetrics(s.runs[BASELINE_ID].result, s.runs[id].result, diff);
    expect(metrics.map((m) => m.key)).toEqual(expect.arrayContaining(['onTimePct', 'avgLateness', 'utilization', 'rerouted', 'undeliverable']));
    expect(JSON.stringify(s.runs[BASELINE_ID].result)).toBe(baseRun);
    // Every row's flags must agree with the underlying results.
    for (const row of diff.rows) {
      if (row.flags.includes('rerouted')) expect(row.a.routeKey).not.toBe(row.b.routeKey);
      if (row.flags.includes('newly_late')) expect([row.a.status, row.b.status]).toEqual(['on_time', 'late']);
      if (row.flags.includes('newly_undeliverable')) expect(row.b.failure.message).toBeTruthy();
      if (!row.affected) expect(row.a.legs).toEqual(row.b.legs);
    }
  });

  it('comparing identical scenarios reports no differences', () => {
    const s = fork(createInitialState());
    const id = lastScenario(s).id;
    const diff = compareShipments(s.runs[BASELINE_ID].result, s.runs[id].result);
    expect(diff.summary.affected).toBe(0);
    expect(compareMetrics(s.runs[BASELINE_ID].result, s.runs[id].result, diff).every((m) => m.delta === 0 || m.delta === null)).toBe(true);
  });

  it('replanning after a closure never routes through the closed connection during the closure', () => {
    let s = fork(createInitialState());
    const id = lastScenario(s).id;
    s = reducer(s, { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'closure', connectionId: 'C04', startHour: 0, endHour: 48 } });
    const result = s.runs[id].result;
    for (const sh of result.shipments) for (const l of sh.legs) if (l.connectionId === 'C04') expect(l.depart >= 48 || l.arrive <= 0).toBe(true);
    expect(verifySchedule(engineInput(getScenario(s, id)), result).ok).toBe(true);
    const base = runSchedule(engineInput(baseline));
    expect(base.shipments.some((sh) => sh.legs.some((l) => l.connectionId === 'C04'))).toBe(true); // the closure really mattered
  });
});

describe('persistence across reloads', () => {
  let storage;
  beforeEach(() => { storage = memoryStorage(); });

  it('saves and restores edits, selection, settings and ids', () => {
    let s = fork(createInitialState(), 'Persisted');
    const id = lastScenario(s).id;
    s = dispatch(
      s,
      { type: 'record/upsert', scenarioId: id, kind: 'shipment', record: { origin: 'T2', destination: 'T6', release: 5, deadline: 40, priority: 3, cargo: 'Grain' } },
      { type: 'record/upsert', scenarioId: id, kind: 'disruption', record: { type: 'travel_time', connectionId: 'C07', startHour: 10, endHour: 30, extraHours: 4 } },
      { type: 'settings/update', settings: { autoRecalc: false } },
    );
    expect(saveState(s, storage).ok).toBe(true);

    // "Reload": build a brand-new state from nothing but what is in storage.
    const { persisted, notices } = loadState(storage);
    expect(notices).toEqual([]);
    const reloaded = createInitialState(persisted);
    expect(reloaded.activeId).toBe(id);
    expect(reloaded.settings.autoRecalc).toBe(false);
    const back = getScenario(reloaded, id);
    expect(back).toEqual(getScenario(s, id));
    expect(back.shipments.at(-1)).toMatchObject({ id: 'S101', cargo: 'Grain' });
    expect(reloaded.runs[id].result).toEqual(runSchedule(engineInput(back)));
    expect(reloaded.nextScenarioNumber).toBe(s.nextScenarioNumber);
    // Reset still works after a reload (snapshot persisted) and ids keep counting up.
    const again = reducer(reloaded, { type: 'record/upsert', scenarioId: id, kind: 'shipment', record: { origin: 'T2', destination: 'T6', release: 5, deadline: 40, priority: 3 } });
    expect(getScenario(again, id).shipments.at(-1).id).toBe('S102');
    const reset = reducer(reloaded, { type: 'scenario/reset', id });
    expect(getScenario(reset, id).shipments).toEqual(baseline.shipments);
  });

  it('never stores the baseline', () => {
    const s = fork(createInitialState());
    const saved = JSON.parse(JSON.stringify(serializeState(s)));
    expect(saved.scenarios.every((x) => x.id !== BASELINE_ID)).toBe(true);
  });

  it('returns nothing when storage is empty and survives corrupted data', () => {
    expect(loadState(storage)).toEqual({ persisted: null, notices: [] });
    for (const junk of ['{not json', '[]', '"x"', 'null', '{"version":99,"scenarios":[]}', '{"version":1}']) {
      storage.setItem(STORAGE_KEY, junk);
      const res = loadState(storage);
      expect(res.persisted).toBeNull();
      expect(res.notices[0].level).toBe('warning');
      expect(createInitialState(res.persisted, res.notices).scenarios).toEqual([]);
    }
  });

  it('drops only the scenarios that fail validation', () => {
    let s = dispatch(createInitialState(), { type: 'scenario/fork', sourceId: BASELINE_ID, name: 'Good' }, { type: 'scenario/fork', sourceId: BASELINE_ID, name: 'Bad' });
    const data = JSON.parse(JSON.stringify(serializeState(s)));
    data.scenarios[1].shipments[0].origin = 'GHOST';
    data.scenarios.push({ id: 'baseline', name: 'sneaky', network: data.scenarios[0].network, shipments: [], disruptions: [] });
    data.scenarios.push('garbage');
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    const { persisted, notices } = loadState(storage);
    expect(persisted.scenarios.map((x) => x.name)).toEqual(['Good']);
    expect(notices).toHaveLength(3);
    const restored = createInitialState(persisted, notices);
    expect(restored.notices).toHaveLength(3);
  });

  it('falls back to the baseline when the saved active scenario is gone and repairs parent links', () => {
    let s = dispatch(createInitialState(), { type: 'scenario/fork', sourceId: BASELINE_ID, name: 'A' });
    const a = lastScenario(s).id;
    s = reducer(s, { type: 'scenario/fork', sourceId: a, name: 'B' });
    const data = JSON.parse(JSON.stringify(serializeState(s)));
    data.activeId = 'sc-999';
    data.scenarios = data.scenarios.filter((x) => x.id !== a);
    storage.setItem(STORAGE_KEY, JSON.stringify(data));
    const { persisted } = loadState(storage);
    const restored = createInitialState(persisted);
    expect(restored.activeId).toBe(BASELINE_ID);
    expect(restored.scenarios[0].parentId).toBeNull();
    expect(restored.nextScenarioNumber).toBeGreaterThan(Number(restored.scenarios[0].id.slice(3)));
  });

  it('reports storage failures instead of throwing', () => {
    const full = { getItem: () => null, setItem: () => { const e = new Error('full'); e.name = 'QuotaExceededError'; throw e; }, removeItem: () => {} };
    expect(saveState(createInitialState(), full)).toEqual({ ok: false, error: 'Browser storage is full' });
    const blocked = { getItem: () => { throw new Error('denied'); }, setItem: () => { throw new Error('denied'); }, removeItem: () => { throw new Error('denied'); } };
    expect(loadState(blocked).notices[0].level).toBe('warning');
    expect(saveState(createInitialState(), blocked).ok).toBe(false);
    expect(() => clearSavedState(blocked)).not.toThrow();
  });

  it('workspace reset followed by a save leaves only the seeded state', () => {
    let s = dispatch(createInitialState(), { type: 'scenario/fork', sourceId: BASELINE_ID });
    saveState(s, storage);
    s = reducer(s, { type: 'workspace/reset' });
    saveState(s, storage);
    expect(createInitialState(loadState(storage).persisted).scenarios).toEqual([]);
  });
});
