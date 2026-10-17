import Ajv from 'ajv';
import { describe, expect, it } from 'vitest';
import schema from '../../schema/rail-scenario.schema.json';
import { generateNetwork, DEFAULT_SEED } from '../../src/data/generator.js';
import { listPresets } from '../../src/data/presets.js';
import { scenarioToDocument, documentToJson, scheduleToCsv } from '../../src/data/serialization.js';
import { checkExpectations } from '../../src/data/expectations.js';
import { parseScenarioText, validateScenarioDocument, validateRecord } from '../../src/data/validation.js';
import { runSchedule, verifySchedule, isStaticallyConnected, buildAdjacency } from '../../src/engine/index.js';
import { getBaseline, engineInput, makeScenario } from '../../src/state/scenarioModel.js';

const baseline = getBaseline();

describe('seeded generator', () => {
  it('produces the specified dataset shape', () => {
    const d = generateNetwork(DEFAULT_SEED);
    expect(d.terminals).toHaveLength(8);
    expect(d.connections.length).toBeGreaterThanOrEqual(14);
    expect(d.shipments).toHaveLength(100);
    expect(new Set(d.shipments.map((s) => s.id)).size).toBe(100);
    const times = new Set(d.connections.map((c) => c.travelTime));
    const caps = new Set(d.connections.map((c) => c.capacity));
    expect(times.size).toBeGreaterThan(1);
    expect(caps.size).toBeGreaterThan(1);
  });

  it('is deterministic: same seed -> identical network and shipments; different seed -> different', () => {
    expect(generateNetwork(DEFAULT_SEED)).toEqual(generateNetwork(DEFAULT_SEED));
    expect(generateNetwork(DEFAULT_SEED + 1)).not.toEqual(generateNetwork(DEFAULT_SEED));
  });

  it('generates a connected network with valid, schedulable data for many seeds', () => {
    for (let seed = 1; seed <= 25; seed++) {
      const d = generateNetwork(seed);
      const adj = buildAdjacency(d.terminals, d.connections);
      for (const t of d.terminals) expect(isStaticallyConnected(adj, 'T1', t.id)).toBe(true);
      const doc = { network: { terminals: d.terminals, connections: d.connections }, shipments: d.shipments };
      expect(validateScenarioDocument(doc).errors).toEqual([]);
      const input = { ...d, disruptions: [] };
      expect(verifySchedule(input, runSchedule(input)).ok).toBe(true);
    }
  });

  it('honours a custom shipment count', () => {
    expect(generateNetwork(5, 12).shipments).toHaveLength(12);
    expect(generateNetwork(5, 0).shipments).toEqual([]);
  });

  it('the seeded baseline is a diverse, derived result (not hardcoded)', () => {
    const result = runSchedule(engineInput(baseline));
    expect(verifySchedule(engineInput(baseline), result).ok).toBe(true);
    const m = result.metrics;
    expect(m.totals.shipments).toBe(100);
    expect(m.totals.onTime + m.totals.late + m.totals.undeliverable).toBe(100);
    expect(m.totals.late).toBeGreaterThan(0);
    expect(m.totals.undeliverable).toBeGreaterThan(0);
    expect(m.totals.onTime).toBeGreaterThan(50);
  });
});

describe('presets', () => {
  const presets = listPresets(baseline);

  it('lists normal, bottleneck, closure, disconnected, conflicting deadline and reference presets', () => {
    const keys = presets.map((p) => p.key);
    expect(keys).toEqual(expect.arrayContaining([
      'reference-three-terminal', 'normal-routing', 'capacity-bottleneck', 'connection-closure', 'disconnected-network', 'conflicting-deadlines',
    ]));
  });

  for (const preset of listPresets(baseline)) {
    it(`${preset.key}: valid, verifiable${preset.expected ? ', and matches its documented expected results' : ''}`, () => {
      const scenario = makeScenario({ id: preset.key, name: preset.name, source: 'preset', body: preset, expected: preset.expected });
      const check = validateScenarioDocument(scenarioToDocument(scenario));
      expect(check.errors).toEqual([]);
      const input = engineInput(scenario);
      const result = runSchedule(input);
      expect(verifySchedule(input, result).violations).toEqual([]);
      if (preset.expected) {
        const rows = checkExpectations(preset.expected, result);
        expect(rows.length).toBeGreaterThan(0);
        expect(rows.filter((r) => !r.pass)).toEqual([]);
      }
    });
  }

  it('the disrupted baseline preset actually changes the outcome', () => {
    const p = presets.find((x) => x.key === 'disrupted-baseline');
    const base = runSchedule(engineInput(baseline));
    const disrupted = runSchedule({ terminals: p.network.terminals, connections: p.network.connections, shipments: p.shipments, disruptions: p.disruptions });
    expect(disrupted.metrics.onTimePct).toBeLessThan(base.metrics.onTimePct);
  });
});

describe('export / import round trip', () => {
  it('exports and re-imports an identical scenario (and identical results)', () => {
    const doc = scenarioToDocument(baseline);
    const parsed = parseScenarioText(documentToJson(doc));
    expect(parsed.errors).toEqual([]);
    expect(parsed.value.network).toEqual(baseline.network);
    expect(parsed.value.shipments).toEqual(baseline.shipments);
    const re = runSchedule({ ...parsed.value.network, shipments: parsed.value.shipments, disruptions: parsed.value.disruptions });
    expect(re).toEqual(runSchedule(engineInput(baseline)));
  });

  it('exports disruptions and expectations of a preset losslessly', () => {
    const p = listPresets(baseline).find((x) => x.key === 'connection-closure');
    const scenario = makeScenario({ id: 'x', name: p.name, source: 'preset', body: p, expected: p.expected });
    const parsed = parseScenarioText(documentToJson(scenarioToDocument(scenario)));
    expect(parsed.value.disruptions).toEqual(p.disruptions);
    expect(parsed.value.expected).toEqual(p.expected);
  });

  it('documents conform to the published JSON schema', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    for (const p of listPresets(baseline)) {
      const scenario = makeScenario({ id: 'x', name: p.name, source: 'preset', body: p, expected: p.expected });
      const doc = scenarioToDocument(scenario);
      expect(validate(doc), JSON.stringify(validate.errors)).toBe(true);
    }
    expect(validate(scenarioToDocument(baseline))).toBe(true);
  });

  it('the schema and the importer agree on malformed documents', () => {
    const ajv = new Ajv({ allErrors: true, strict: false });
    const validate = ajv.compile(schema);
    const good = scenarioToDocument(baseline);
    const bad = [
      (d) => { d.shipments[0].priority = 9; },
      (d) => { d.shipments[0].release = 1.5; },
      (d) => { d.network.connections[0].travelTime = 0; },
      (d) => { d.network.connections[0].capacity = -1; },
      (d) => { delete d.network.terminals; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'meteor', connectionId: 'C01', startHour: 0, endHour: 5 }]; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'closure', connectionId: 'C01', startHour: 0 }]; },
      (d) => { d.shipments[0].id = 'bad id!'; },
      (d) => { d.version = 2; },
    ];
    for (const mutate of bad) {
      const doc = structuredClone(good);
      mutate(doc);
      expect(validate(doc), 'schema should reject').toBe(false);
      expect(validateScenarioDocument(doc).ok, 'importer should reject').toBe(false);
    }
  });
});

describe('import validation', () => {
  const good = () => structuredClone(scenarioToDocument(listPresets(baseline)[0] && makeScenario({ id: 'x', name: 'x', source: 'preset', body: listPresets(baseline)[0] })));
  const errorsOf = (doc) => validateScenarioDocument(doc).errors.map((e) => `${e.path} ${e.message}`);

  it('accepts a good document', () => {
    expect(validateScenarioDocument(good()).ok).toBe(true);
  });

  it('handles malformed text without throwing', () => {
    for (const text of ['', '{', 'not json', 'null', '[]', '42', '"str"', '{"network": 5}', undefined, null]) {
      const res = parseScenarioText(text);
      expect(res.ok).toBe(false);
      expect(res.errors.length).toBeGreaterThan(0);
    }
  });

  it('rejects oversized files', () => {
    expect(parseScenarioText('x'.repeat(6 * 1024 * 1024)).errors[0].message).toMatch(/larger/);
  });

  it('rejects wrong schema id and unsupported versions', () => {
    expect(errorsOf({ ...good(), schema: 'other' })[0]).toMatch(/schema/);
    expect(errorsOf({ ...good(), version: 7 })[0]).toMatch(/version/);
  });

  it('rejects duplicate ids, unknown references and self-loops', () => {
    const d = good();
    d.shipments.push({ ...d.shipments[0] });
    expect(errorsOf(d).join('\n')).toMatch(/already used by another shipment/);
    const e = good();
    e.shipments[0].origin = 'ZZ';
    expect(errorsOf(e).join('\n')).toMatch(/unknown terminal "ZZ"/);
    const f = good();
    f.network.connections[0].to = f.network.connections[0].from;
    expect(errorsOf(f).join('\n')).toMatch(/same terminal/);
    const g = good();
    g.disruptions = [{ id: 'D1', type: 'closure', connectionId: 'NOPE', startHour: 0, endHour: 4 }];
    expect(errorsOf(g).join('\n')).toMatch(/unknown connection/);
    const h = good();
    h.disruptions = [{ id: 'D1', type: 'release_delay', shipmentId: 'NOPE', delayHours: 4 }];
    expect(errorsOf(h).join('\n')).toMatch(/unknown shipment/);
  });

  it('rejects bad numbers: fractions, negatives, strings, NaN-like, reversed intervals, deadline before release', () => {
    const cases = [
      (d) => { d.shipments[0].release = -1; },
      (d) => { d.shipments[0].release = '8'; },
      (d) => { d.shipments[0].deadline = d.shipments[0].release - 1; },
      (d) => { d.shipments[0].priority = 0; },
      (d) => { d.shipments[0].destination = d.shipments[0].origin; },
      (d) => { d.network.connections[0].travelTime = 2.5; },
      (d) => { d.network.connections[0].capacity = 0; },
      (d) => { d.network.terminals[0].x = 'left'; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'closure', connectionId: d.network.connections[0].id, startHour: 10, endHour: 10 }]; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'capacity', connectionId: d.network.connections[0].id, startHour: 1, endHour: 4, capacity: -1 }]; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'travel_time', connectionId: d.network.connections[0].id, startHour: 1, endHour: 4, extraHours: 0 }]; },
      (d) => { d.disruptions = [{ id: 'D1', type: 'release_delay', shipmentId: d.shipments[0].id, delayHours: 0 }]; },
      (d) => { d.expected = { shipments: { S1: { status: 'maybe' } } }; },
      (d) => { d.shipments = {}; },
    ];
    for (const mutate of cases) {
      const d = good();
      mutate(d);
      expect(validateScenarioDocument(d).ok, JSON.stringify(mutate.toString())).toBe(false);
    }
  });

  it('is safe against prototype-pollution style keys', () => {
    const text = '{"network":{"terminals":[{"id":"A","name":"A"},{"id":"B","name":"B"}],"connections":[{"id":"AB","from":"A","to":"B","travelTime":1,"capacity":1}]},"shipments":[{"id":"__proto__","origin":"A","destination":"B","release":0,"deadline":3,"priority":2}],"__proto__":{"polluted":true},"expected":{"shipments":{"__proto__":{"status":"late"}}}}';
    const res = parseScenarioText(text);
    expect(res.ok).toBe(false);
    expect({}.polluted).toBeUndefined();
  });

  it('enforces size limits', () => {
    const d = good();
    d.shipments = Array.from({ length: 1001 }, (_, i) => ({ id: `S${i}`, origin: 'A', destination: 'C', release: 0, deadline: 5, priority: 2 }));
    expect(errorsOf(d).join('\n')).toMatch(/maximum is 1000/);
  });

  it('drops unknown properties with a warning instead of failing', () => {
    const d = good();
    d.mystery = 1;
    d.shipments[0].colour = 'red';
    const res = validateScenarioDocument(d);
    expect(res.ok).toBe(true);
    expect(res.warnings.map((w) => w.path)).toEqual(expect.arrayContaining(['$.mystery', 'shipments[0].colour']));
    expect(res.value.shipments[0].colour).toBeUndefined();
  });

  it('adds a deterministic layout when terminals have no coordinates', () => {
    const d = good();
    d.network.terminals.forEach((t) => { delete t.x; delete t.y; });
    const a = validateScenarioDocument(d).value.network.terminals;
    const b = validateScenarioDocument(structuredClone(d)).value.network.terminals;
    expect(a).toEqual(b);
    expect(a.every((t) => Number.isFinite(t.x) && Number.isFinite(t.y))).toBe(true);
  });

  it('allows partial documents when the network is not required', () => {
    const res = validateScenarioDocument({ shipments: [] }, { requireNetwork: false });
    expect(res.ok).toBe(true);
    expect(res.sections).toMatchObject({ network: false, shipments: true });
    expect(validateScenarioDocument({ shipments: [] }).ok).toBe(false);
  });

  it('warns about releases at or after the horizon', () => {
    const d = good();
    d.shipments[0].release = 170;
    d.shipments[0].deadline = 180;
    const res = validateScenarioDocument(d);
    expect(res.ok).toBe(true);
    expect(res.warnings.some((w) => /horizon/.test(w.message))).toBe(true);
  });
});

describe('record validation for editor forms', () => {
  const scenario = makeScenario({ id: 'x', name: 'x', source: 'custom', body: listPresets(baseline)[0] });
  it('reports only problems of the edited record', () => {
    expect(validateRecord('shipment', { id: 'S9', origin: 'A', destination: 'C', release: 0, deadline: 5, priority: 2 }, scenario)).toEqual([]);
    const errs = validateRecord('shipment', { id: 'S9', origin: 'A', destination: 'A', release: 5, deadline: 1, priority: 7 }, scenario);
    expect(errs.length).toBeGreaterThanOrEqual(3);
    expect(validateRecord('shipment', { id: 'S1', origin: 'A', destination: 'C', release: 0, deadline: 5, priority: 2 }, scenario)[0]).toMatch(/already used/);
    expect(validateRecord('shipment', { id: 'S1', origin: 'A', destination: 'C', release: 0, deadline: 5, priority: 2 }, scenario, { editingId: 'S1' })).toEqual([]);
    expect(validateRecord('connection', { id: 'X1', from: 'A', to: 'Q', travelTime: 1, capacity: 1 }, scenario)[0]).toMatch(/unknown terminal/);
    expect(validateRecord('disruption', { id: 'D1', type: 'closure', connectionId: 'AB', startHour: 5, endHour: 3 }, scenario)[0]).toMatch(/greater than/);
  });
});

describe('expectations and CSV', () => {
  it('flags mismatches', () => {
    const p = listPresets(baseline)[0];
    const scenario = makeScenario({ id: 'x', name: 'x', source: 'preset', body: p, expected: p.expected });
    const result = runSchedule(engineInput(scenario));
    const wrong = { shipments: { S1: { arrival: 99, status: 'late', route: ['AB'], departures: [1] }, NOPE: { status: 'late' } } };
    const rows = checkExpectations(wrong, result);
    expect(rows.every((r) => r.pass === false)).toBe(true);
    expect(rows.length).toBe(5);
  });

  it('exports one CSV row per movement', () => {
    const p = listPresets(baseline)[0];
    const scenario = makeScenario({ id: 'x', name: 'x', source: 'preset', body: p });
    const csv = scheduleToCsv(runSchedule(engineInput(scenario)));
    expect(csv.trim().split('\n')).toHaveLength(1 + 6);
    expect(csv.split('\n')[1]).toContain('S1,2,on_time,1,AB,A,B,8,9,0,8,14,10');
  });
});
