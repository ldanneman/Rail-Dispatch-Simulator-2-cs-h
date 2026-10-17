import { DISRUPTION } from '../engine/constants.js';

/*
 * Pure, cascade-aware edits on a scenario body. They keep relationships consistent:
 *  - removing a terminal removes its connections and shipments
 *  - removing a connection removes disruptions on it
 *  - removing a shipment removes its release delays
 * Each function returns { body, removed } where `removed` counts what was cascaded.
 */

const withoutDisruptionsFor = (disruptions, connIds, shipIds) =>
  disruptions.filter((d) =>
    d.type === DISRUPTION.RELEASE_DELAY ? !shipIds.has(d.shipmentId) : !connIds.has(d.connectionId),
  );

export function removeTerminal(body, id) {
  const connections = body.network.connections.filter((c) => c.from !== id && c.to !== id);
  const goneConns = new Set(body.network.connections.filter((c) => c.from === id || c.to === id).map((c) => c.id));
  const shipments = body.shipments.filter((s) => s.origin !== id && s.destination !== id);
  const goneShips = new Set(body.shipments.filter((s) => s.origin === id || s.destination === id).map((s) => s.id));
  const disruptions = withoutDisruptionsFor(body.disruptions, goneConns, goneShips);
  return {
    body: {
      network: { terminals: body.network.terminals.filter((t) => t.id !== id), connections },
      shipments,
      disruptions,
    },
    removed: {
      connections: goneConns.size,
      shipments: goneShips.size,
      disruptions: body.disruptions.length - disruptions.length,
    },
  };
}

export function removeConnection(body, id) {
  const disruptions = withoutDisruptionsFor(body.disruptions, new Set([id]), new Set());
  return {
    body: {
      network: { ...body.network, connections: body.network.connections.filter((c) => c.id !== id) },
      shipments: body.shipments,
      disruptions,
    },
    removed: { connections: 0, shipments: 0, disruptions: body.disruptions.length - disruptions.length },
  };
}

export function removeShipment(body, id) {
  const disruptions = withoutDisruptionsFor(body.disruptions, new Set(), new Set([id]));
  return {
    body: { network: body.network, shipments: body.shipments.filter((s) => s.id !== id), disruptions },
    removed: { connections: 0, shipments: 0, disruptions: body.disruptions.length - disruptions.length },
  };
}

/** What deleting something would take with it - shown in the confirmation dialog. */
export function previewRemoval(body, kind, id) {
  if (kind === 'terminal') return removeTerminal(body, id).removed;
  if (kind === 'connection') return removeConnection(body, id).removed;
  if (kind === 'shipment') return removeShipment(body, id).removed;
  return { connections: 0, shipments: 0, disruptions: 0 };
}

const upsert = (list, record) => {
  const i = list.findIndex((x) => x.id === record.id);
  if (i === -1) return [...list, record];
  const copy = [...list];
  copy[i] = record;
  return copy;
};

export const upsertTerminal = (body, t) => ({ ...body, network: { ...body.network, terminals: upsert(body.network.terminals, t) } });
export const upsertConnection = (body, c) => ({ ...body, network: { ...body.network, connections: upsert(body.network.connections, c) } });
export const upsertShipment = (body, s) => ({ ...body, shipments: upsert(body.shipments, s) });
export const upsertDisruption = (body, d) => ({ ...body, disruptions: upsert(body.disruptions, d) });
export const removeDisruption = (body, id) => ({ ...body, disruptions: body.disruptions.filter((d) => d.id !== id) });
