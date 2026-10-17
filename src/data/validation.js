import { DISRUPTION, HORIZON_HOURS, LIMITS, STATUS } from '../engine/constants.js';

export const SCHEMA_ID = 'rail-dispatch-scenario';
export const SCHEMA_VERSION = 1;
export const MAX_IMPORT_BYTES = 5 * 1024 * 1024;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,23}$/;
const DISRUPTION_TYPES = Object.values(DISRUPTION);
const STATUSES = Object.values(STATUS);

const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isInt = (v) => typeof v === 'number' && Number.isInteger(v);

/** Collects errors with JSON-path-like locations and normalises (copies, trims, drops unknown keys). */
class Report {
  constructor() {
    this.errors = [];
    this.warnings = [];
  }
  error(path, message) {
    this.errors.push({ path, message });
  }
  warn(path, message) {
    this.warnings.push({ path, message });
  }
}

function readString(r, obj, key, path, { min = 1, max = 80, optional = false, fallback } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (!optional) r.error(`${path}.${key}`, 'is required');
    return fallback;
  }
  if (typeof v !== 'string') {
    r.error(`${path}.${key}`, 'must be a string');
    return fallback;
  }
  const t = v.trim();
  if (t.length < min || t.length > max) {
    r.error(`${path}.${key}`, `must be ${min === max ? min : `${min}-${max}`} characters long`);
    return fallback;
  }
  return t;
}

function readId(r, obj, key, path) {
  const v = obj[key];
  if (typeof v !== 'string') {
    r.error(`${path}.${key}`, v === undefined ? 'is required' : 'must be a string');
    return undefined;
  }
  if (!ID_PATTERN.test(v)) {
    r.error(`${path}.${key}`, `"${v.slice(0, 30)}" is not a valid id (letters, digits, "_", "-", "." ; 1-24 characters; must start with a letter or digit)`);
    return undefined;
  }
  return v;
}

function readInt(r, obj, key, path, { min = 0, max = LIMITS.maxHour, optional = false, fallback } = {}) {
  const v = obj[key];
  if (v === undefined || v === null) {
    if (!optional) r.error(`${path}.${key}`, 'is required');
    return fallback;
  }
  if (!isInt(v)) {
    r.error(`${path}.${key}`, 'must be a whole number');
    return fallback;
  }
  if (v < min || v > max) {
    r.error(`${path}.${key}`, `must be between ${min} and ${max}`);
    return fallback;
  }
  return v;
}

function warnUnknown(r, obj, known, path) {
  for (const k of Object.keys(obj)) if (!known.includes(k)) r.warn(`${path}.${k}`, 'unknown property ignored');
}

function readList(r, value, path, max, label) {
  if (!Array.isArray(value)) {
    r.error(path, 'must be an array');
    return null;
  }
  if (value.length > max) {
    r.error(path, `has ${value.length} ${label}; the maximum is ${max}`);
    return null;
  }
  return value;
}

/** Deterministic circular layout used when terminals carry no coordinates. */
export function circularLayout(index, count) {
  const angle = (index / Math.max(1, count)) * 2 * Math.PI - Math.PI / 2;
  return { x: Math.round(50 + 40 * Math.cos(angle)), y: Math.round(32 + 26 * Math.sin(angle)) };
}

function checkUnique(r, items, path, label) {
  const seen = new Set();
  items.forEach((item, i) => {
    if (item.id === undefined) return;
    if (seen.has(item.id)) r.error(`${path}[${i}].id`, `"${item.id}" is already used by another ${label}`);
    seen.add(item.id);
  });
  return seen;
}

export function normalizeNetwork(r, net, path = 'network') {
  if (!isObject(net)) {
    r.error(path, 'must be an object with "terminals" and "connections"');
    return null;
  }
  warnUnknown(r, net, ['terminals', 'connections'], path);
  const tList = readList(r, net.terminals, `${path}.terminals`, LIMITS.terminals, 'terminals');
  const cList = readList(r, net.connections, `${path}.connections`, LIMITS.connections, 'connections');
  if (!tList || !cList) return null;

  const terminals = tList.map((t, i) => {
    const p = `${path}.terminals[${i}]`;
    if (!isObject(t)) {
      r.error(p, 'must be an object');
      return {};
    }
    warnUnknown(r, t, ['id', 'name', 'x', 'y'], p);
    const out = { id: readId(r, t, 'id', p), name: readString(r, t, 'name', p, { max: 60, optional: true }) };
    if (out.name === undefined) out.name = out.id;
    for (const axis of ['x', 'y']) {
      const v = t[axis];
      if (v === undefined) continue;
      if (typeof v !== 'number' || !Number.isFinite(v) || v < -1000 || v > 1000) r.error(`${p}.${axis}`, 'must be a number between -1000 and 1000');
      else out[axis] = v;
    }
    return out;
  });
  const terminalIds = checkUnique(r, terminals, `${path}.terminals`, 'terminal');
  terminals.forEach((t, i) => {
    if (t.x === undefined || t.y === undefined) Object.assign(t, circularLayout(i, terminals.length));
  });

  const connections = cList.map((c, i) => {
    const p = `${path}.connections[${i}]`;
    if (!isObject(c)) {
      r.error(p, 'must be an object');
      return {};
    }
    warnUnknown(r, c, ['id', 'from', 'to', 'travelTime', 'capacity', 'bidirectional'], p);
    const out = {
      id: readId(r, c, 'id', p),
      from: readId(r, c, 'from', p),
      to: readId(r, c, 'to', p),
      travelTime: readInt(r, c, 'travelTime', p, { min: 1, max: LIMITS.maxTravelTime }),
      capacity: readInt(r, c, 'capacity', p, { min: 1, max: LIMITS.maxCapacity }),
      bidirectional: true,
    };
    if (c.bidirectional !== undefined) {
      if (typeof c.bidirectional !== 'boolean') r.error(`${p}.bidirectional`, 'must be true or false');
      else out.bidirectional = c.bidirectional;
    }
    if (out.from && !terminalIds.has(out.from)) r.error(`${p}.from`, `unknown terminal "${out.from}"`);
    if (out.to && !terminalIds.has(out.to)) r.error(`${p}.to`, `unknown terminal "${out.to}"`);
    if (out.from && out.from === out.to) r.error(`${p}.to`, 'a connection cannot start and end at the same terminal');
    return out;
  });
  checkUnique(r, connections, `${path}.connections`, 'connection');
  return { terminals, connections };
}

export function normalizeShipments(r, list, terminalIds, path = 'shipments') {
  const arr = readList(r, list, path, LIMITS.shipments, 'shipments');
  if (!arr) return null;
  const shipments = arr.map((s, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(s)) {
      r.error(p, 'must be an object');
      return {};
    }
    warnUnknown(r, s, ['id', 'origin', 'destination', 'release', 'deadline', 'priority', 'cargo'], p);
    const out = {
      id: readId(r, s, 'id', p),
      origin: readId(r, s, 'origin', p),
      destination: readId(r, s, 'destination', p),
      release: readInt(r, s, 'release', p),
      deadline: readInt(r, s, 'deadline', p),
      priority: readInt(r, s, 'priority', p, { min: 1, max: 4 }),
    };
    const cargo = readString(r, s, 'cargo', p, { max: 40, optional: true });
    if (cargo !== undefined) out.cargo = cargo;
    if (terminalIds) {
      if (out.origin && !terminalIds.has(out.origin)) r.error(`${p}.origin`, `unknown terminal "${out.origin}"`);
      if (out.destination && !terminalIds.has(out.destination)) r.error(`${p}.destination`, `unknown terminal "${out.destination}"`);
    }
    if (out.origin && out.origin === out.destination) r.error(`${p}.destination`, 'origin and destination must differ');
    if (out.release !== undefined && out.deadline !== undefined && out.deadline < out.release) {
      r.error(`${p}.deadline`, `deadline ${out.deadline} is before the release time ${out.release}`);
    }
    if (out.release !== undefined && out.release >= HORIZON_HOURS) {
      r.warn(`${p}.release`, `release ${out.release} is at or after the ${HORIZON_HOURS}-hour planning horizon; the shipment will be undeliverable`);
    }
    return out;
  });
  checkUnique(r, shipments, path, 'shipment');
  return shipments;
}

export function normalizeDisruptions(r, list, connectionIds, shipmentIds, path = 'disruptions') {
  const arr = readList(r, list, path, LIMITS.disruptions, 'disruptions');
  if (!arr) return null;
  const disruptions = arr.map((d, i) => {
    const p = `${path}[${i}]`;
    if (!isObject(d)) {
      r.error(p, 'must be an object');
      return {};
    }
    const id = readId(r, d, 'id', p);
    const type = d.type;
    if (!DISRUPTION_TYPES.includes(type)) {
      r.error(`${p}.type`, `must be one of ${DISRUPTION_TYPES.join(', ')}`);
      return { id };
    }
    const out = { id, type };
    const note = readString(r, d, 'note', p, { max: 200, optional: true });
    if (note !== undefined) out.note = note;
    const known = ['id', 'type', 'note'];
    if (type === DISRUPTION.RELEASE_DELAY) {
      known.push('shipmentId', 'delayHours');
      out.shipmentId = readId(r, d, 'shipmentId', p);
      out.delayHours = readInt(r, d, 'delayHours', p, { min: 1 });
      if (shipmentIds && out.shipmentId && !shipmentIds.has(out.shipmentId)) r.error(`${p}.shipmentId`, `unknown shipment "${out.shipmentId}"`);
    } else {
      known.push('connectionId', 'startHour', 'endHour');
      out.connectionId = readId(r, d, 'connectionId', p);
      out.startHour = readInt(r, d, 'startHour', p);
      out.endHour = readInt(r, d, 'endHour', p, { min: 1 });
      if (out.startHour !== undefined && out.endHour !== undefined && out.endHour <= out.startHour) {
        r.error(`${p}.endHour`, `endHour ${out.endHour} must be greater than startHour ${out.startHour}`);
      }
      if (connectionIds && out.connectionId && !connectionIds.has(out.connectionId)) r.error(`${p}.connectionId`, `unknown connection "${out.connectionId}"`);
      if (type === DISRUPTION.TRAVEL_TIME) {
        known.push('extraHours');
        out.extraHours = readInt(r, d, 'extraHours', p, { min: 1, max: LIMITS.maxTravelTime });
      } else if (type === DISRUPTION.CAPACITY) {
        known.push('capacity');
        out.capacity = readInt(r, d, 'capacity', p, { min: 0, max: LIMITS.maxCapacity });
      }
    }
    warnUnknown(r, d, known, p);
    return out;
  });
  checkUnique(r, disruptions, path, 'disruption');
  return disruptions;
}

export function normalizeExpected(r, exp, shipmentIds, path = 'expected') {
  if (!isObject(exp)) {
    r.error(path, 'must be an object');
    return null;
  }
  warnUnknown(r, exp, ['notes', 'shipments'], path);
  const out = {};
  const notes = readString(r, exp, 'notes', path, { max: 1000, optional: true });
  if (notes !== undefined) out.notes = notes;
  out.shipments = {};
  if (exp.shipments !== undefined) {
    if (!isObject(exp.shipments)) {
      r.error(`${path}.shipments`, 'must be an object keyed by shipment id');
    } else {
      for (const [id, e] of Object.entries(exp.shipments)) {
        const p = `${path}.shipments.${id}`;
        if (!ID_PATTERN.test(id)) {
          r.error(p, 'key is not a valid shipment id');
          continue;
        }
        if (shipmentIds && !shipmentIds.has(id)) r.warn(p, 'refers to a shipment that is not in this file');
        if (!isObject(e)) {
          r.error(p, 'must be an object');
          continue;
        }
        warnUnknown(r, e, ['status', 'arrival', 'route', 'departures'], p);
        const item = {};
        if (e.status !== undefined) {
          if (!STATUSES.includes(e.status)) r.error(`${p}.status`, `must be one of ${STATUSES.join(', ')}`);
          else item.status = e.status;
        }
        if (e.arrival !== undefined) {
          if (!isInt(e.arrival) || e.arrival < 0) r.error(`${p}.arrival`, 'must be a whole number >= 0');
          else item.arrival = e.arrival;
        }
        if (e.route !== undefined) {
          if (!Array.isArray(e.route) || e.route.some((c) => typeof c !== 'string' || !ID_PATTERN.test(c))) r.error(`${p}.route`, 'must be an array of connection ids');
          else item.route = [...e.route];
        }
        if (e.departures !== undefined) {
          if (!Array.isArray(e.departures) || e.departures.some((h) => !isInt(h) || h < 0)) r.error(`${p}.departures`, 'must be an array of whole hours');
          else item.departures = [...e.departures];
        }
        out.shipments[id] = item;
      }
    }
  }
  return out;
}

/**
 * Validate an in-memory scenario document (already JSON-parsed).
 *
 * options.requireNetwork: the "network" section must be present (default true)
 * Returns { ok, errors, warnings, sections, value } where value holds only the
 * sections present in the document, normalised. Cross references are checked among
 * the sections that are present.
 */
export function validateScenarioDocument(doc, { requireNetwork = true } = {}) {
  const r = new Report();
  if (!isObject(doc)) {
    r.error('$', 'the file must contain a JSON object');
    return { ok: false, errors: r.errors, warnings: r.warnings, sections: {}, value: null };
  }
  if (doc.schema !== undefined && doc.schema !== SCHEMA_ID) {
    r.error('schema', `expected "${SCHEMA_ID}" but found ${JSON.stringify(doc.schema)?.slice(0, 40)}`);
  }
  if (doc.version !== undefined && doc.version !== SCHEMA_VERSION) {
    r.error('version', `unsupported version ${JSON.stringify(doc.version)?.slice(0, 20)}; this app reads version ${SCHEMA_VERSION}`);
  }
  warnUnknown(r, doc, ['schema', 'version', 'name', 'description', 'network', 'shipments', 'disruptions', 'expected'], '$');

  const value = {};
  const name = readString(r, doc, 'name', '$', { max: 60, optional: true });
  if (name !== undefined) value.name = name;
  const description = readString(r, doc, 'description', '$', { min: 0, max: 500, optional: true });
  if (description !== undefined) value.description = description;

  const has = (k) => doc[k] !== undefined;
  if (requireNetwork && !has('network')) r.error('network', 'is required');
  const sections = { network: has('network'), shipments: has('shipments'), disruptions: has('disruptions'), expected: has('expected') };

  let terminalIds = null;
  let connectionIds = null;
  if (has('network')) {
    value.network = normalizeNetwork(r, doc.network);
    if (value.network) {
      terminalIds = new Set(value.network.terminals.map((t) => t.id).filter(Boolean));
      connectionIds = new Set(value.network.connections.map((c) => c.id).filter(Boolean));
    }
  }
  let shipmentIds = null;
  if (has('shipments')) {
    value.shipments = normalizeShipments(r, doc.shipments, terminalIds);
    if (value.shipments) shipmentIds = new Set(value.shipments.map((s) => s.id).filter(Boolean));
  }
  if (has('disruptions')) {
    value.disruptions = normalizeDisruptions(r, doc.disruptions, connectionIds, shipmentIds);
  }
  if (has('expected')) value.expected = normalizeExpected(r, doc.expected, shipmentIds);

  return { ok: r.errors.length === 0, errors: r.errors, warnings: r.warnings, sections, value: r.errors.length ? null : value };
}

/** Validate a fully assembled scenario body {network, shipments, disruptions, expected?}: structure and every reference. */
export function validateScenarioBody(body) {
  const doc = { network: body.network, shipments: body.shipments ?? [], disruptions: body.disruptions ?? [] };
  if (body.expected) doc.expected = body.expected;
  return validateScenarioDocument(doc);
}

/** Parse + validate raw text from a file or from localStorage. Never throws. */
export function parseScenarioText(text, options) {
  if (typeof text !== 'string') {
    return { ok: false, errors: [{ path: '$', message: 'no file content' }], warnings: [], sections: {}, value: null };
  }
  if (text.length > MAX_IMPORT_BYTES) {
    return { ok: false, errors: [{ path: '$', message: `file is larger than ${MAX_IMPORT_BYTES / 1024 / 1024} MB` }], warnings: [], sections: {}, value: null };
  }
  let doc;
  try {
    doc = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [{ path: '$', message: `not valid JSON (${e.message})` }], warnings: [], sections: {}, value: null };
  }
  return validateScenarioDocument(doc, options);
}

// ---- single-record validators used by the editor forms --------------------------------------

/**
 * Validate one editor-form record exactly as an import would, against the live scenario.
 * The record is appended to the other records of its kind, so only errors located at its
 * own index are reported. Returns { errors: string[], record } where `record` is the
 * normalised copy to store (trimmed strings, defaults applied, unknown keys dropped).
 */
export function checkRecord(kind, record, scenario, { editingId = null } = {}) {
  const r = new Report();
  const terminalIds = new Set(scenario.network.terminals.map((t) => t.id));
  const connectionIds = new Set(scenario.network.connections.map((c) => c.id));
  const shipmentIds = new Set(scenario.shipments.map((s) => s.id));
  const others = (list) => list.filter((x) => x.id !== editingId);
  let index;
  let normalized;
  if (kind === 'terminal') {
    const list = others(scenario.network.terminals);
    index = list.length;
    normalized = normalizeNetwork(r, { terminals: [...list, record], connections: [] })?.terminals[index];
  } else if (kind === 'connection') {
    const list = others(scenario.network.connections);
    index = list.length;
    normalized = normalizeNetwork(r, { terminals: scenario.network.terminals, connections: [...list, record] })?.connections[index];
  } else if (kind === 'shipment') {
    const list = others(scenario.shipments);
    index = list.length;
    normalized = normalizeShipments(r, [...list, record], terminalIds)?.[index];
  } else {
    const list = others(scenario.disruptions);
    index = list.length;
    normalized = normalizeDisruptions(r, [...list, record], connectionIds, shipmentIds)?.[index];
  }
  const errors = r.errors
    .filter((e) => e.path.includes(`[${index}]`))
    .map((e) => {
      const field = e.path.split('.').pop();
      return e.message.startsWith(field) ? e.message : `${field} ${e.message}`;
    });
  return { errors, record: errors.length ? null : normalized };
}

/** Error messages only (empty list = valid); see checkRecord. */
export const validateRecord = (kind, record, scenario, options) => checkRecord(kind, record, scenario, options).errors;
