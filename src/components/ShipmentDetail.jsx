import { useMemo } from 'react';
import { describeDisruption } from '../engine/diagnose.js';
import { LATE_CAUSE } from '../engine/constants.js';
import NetworkMap from './NetworkMap.jsx';
import DataTable from './DataTable.jsx';
import { Banner, Drawer, PriorityBadge, StatusBadge } from './ui.jsx';
import { dayLabel, fmtNum } from '../utils/format.js';

const CAUSE_TEXT = {
  [LATE_CAUSE.DEADLINE_INFEASIBLE]: 'The deadline is shorter than the minimum possible transit, so this shipment is late regardless of congestion.',
  [LATE_CAUSE.DISRUPTION]: 'Would be on time without the active disruptions.',
  [LATE_CAUSE.CONGESTION]: 'Would be on time if connection capacity were unlimited; it queued behind other shipments.',
};

/**
 * Everything the scheduler decided for one shipment: route, per-connection departure/arrival,
 * waiting, final delivery and (if unrouted) the reason.
 */
export function ShipmentDetailBody({ shipmentId, run, refRun, refName }) {
  const { result, input } = run;
  const r = useMemo(() => result.shipments.find((s) => s.id === shipmentId), [result, shipmentId]);
  const source = useMemo(() => input.shipments.find((s) => s.id === shipmentId), [input, shipmentId]);
  const ref = useMemo(() => refRun?.result.shipments.find((s) => s.id === shipmentId) ?? null, [refRun, shipmentId]);
  const names = useMemo(() => new Map(input.terminals.map((t) => [t.id, t.name])), [input]);
  if (!r) return <p className="muted">That shipment is not part of the last calculated schedule.</p>;

  const affecting = input.disruptions.filter((d) =>
    d.shipmentId ? d.shipmentId === r.id : r.legs.some((l) => l.connectionId === d.connectionId && l.depart < d.endHour && d.startHour < l.arrive),
  );

  const legColumns = [
    { key: 'index', header: '#', render: (l) => l.index + 1, sortable: false },
    { key: 'connectionId', header: 'Connection', sortable: false, render: (l) => <span className="mono">{l.connectionId}</span> },
    { key: 'route', header: 'From → To', sortable: false, render: (l) => `${l.from} → ${l.to}` },
    { key: 'waitBefore', header: 'Waited before', align: 'r', sortable: false, render: (l) => `${l.waitBefore} h` },
    { key: 'depart', header: 'Departs', align: 'r', sortable: false, render: (l) => <span title={dayLabel(l.depart)}>h{l.depart}</span> },
    { key: 'travelTime', header: 'Travel', align: 'r', sortable: false, render: (l) => `${l.travelTime} h` },
    { key: 'arrive', header: 'Arrives', align: 'r', sortable: false, render: (l) => <span title={dayLabel(l.arrive)}>h{l.arrive}</span> },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <dl className="kv">
        <div><dt>Route</dt><dd>{r.origin} → {r.destination}</dd></div>
        <div><dt>Priority</dt><dd><PriorityBadge priority={r.priority} /></dd></div>
        {source?.cargo && <div><dt>Cargo</dt><dd>{source.cargo}</dd></div>}
        <div><dt>Release</dt><dd title={dayLabel(r.release)}>h{r.release}</dd></div>
        {r.effectiveRelease !== r.release && <div><dt>Effective release (delayed)</dt><dd title={dayLabel(r.effectiveRelease)}>h{r.effectiveRelease} (+{r.effectiveRelease - r.release})</dd></div>}
        <div><dt>Deadline</dt><dd title={dayLabel(r.deadline)}>h{r.deadline}</dd></div>
        <div><dt>Final delivery</dt><dd title={dayLabel(r.arrival)}>{r.arrival === null ? '—' : `h${r.arrival}`}</dd></div>
        <div><dt>Lateness</dt><dd>{r.lateness === null ? '—' : `${r.lateness} h`}</dd></div>
        <div><dt>Transit (from release)</dt><dd>{r.transitHours === null ? '—' : `${r.transitHours} h`}</dd></div>
        <div><dt>Total waiting</dt><dd>{r.waitHours === null ? '—' : `${r.waitHours} h`}</dd></div>
        <div><dt>Earliest possible (no disruption/congestion)</dt><dd>{r.minArrival === null ? '—' : `h${r.minArrival}`}</dd></div>
        <div><dt>Earliest with disruptions only</dt><dd>{r.floorArrival === null ? '—' : `h${r.floorArrival}`}</dd></div>
      </dl>

      {r.failure && <Banner tone="error"><strong>Why it could not be routed:</strong> {r.failure.message}</Banner>}
      {r.lateCause && <Banner tone="warning"><strong>Late by {r.lateness} h.</strong> {CAUSE_TEXT[r.lateCause]}</Banner>}

      <section>
        <h3>Route</h3>
        {r.legs.length ? (
          <NetworkMap terminals={input.terminals} connections={input.connections} disruptions={input.disruptions} highlightLegs={r.legs} label={`Route of shipment ${r.id}`} />
        ) : (
          <p className="muted">No route was found, so there is nothing to draw.</p>
        )}
      </section>

      {r.legs.length > 0 && (
        <section>
          <h3>Scheduled movements</h3>
          <div className="card"><DataTable columns={legColumns} rows={r.legs} rowKey={(l) => l.index} dense caption={`Movements of shipment ${r.id}`} /></div>
          <p className="muted" style={{ marginTop: 8 }}>
            {r.legs.map((l) => names.get(l.from) ?? l.from).concat(names.get(r.destination) ?? r.destination).join(' → ')}
            {' · '}departs h{r.departure}, arrives h{r.arrival} ({fmtNum(r.legs.length, 0)} movement{r.legs.length === 1 ? '' : 's'}).
          </p>
        </section>
      )}

      {affecting.length > 0 && (
        <section>
          <h3>Disruptions touching this shipment</h3>
          <ul>{affecting.map((d) => <li key={d.id}><span className="mono">{d.id}</span> — {describeDisruption(d)}</li>)}</ul>
        </section>
      )}

      {ref && refRun !== run && (
        <section>
          <h3>Compared with {refName}</h3>
          <p className="muted">
            There: <StatusBadge status={ref.status} /> {ref.arrival !== null ? `arrival h${ref.arrival}` : 'not routed'}
            {ref.routeKey && <> via <span className="mono">{ref.routeKey.replaceAll('>', ' › ')}</span></>}.
            {' '}Here: {r.arrival !== null ? `arrival h${r.arrival}` : 'not routed'}
            {r.routeKey && <> via <span className="mono">{r.routeKey.replaceAll('>', ' › ')}</span></>}
            {ref.arrival !== null && r.arrival !== null && ` (${r.arrival - ref.arrival >= 0 ? '+' : '−'}${Math.abs(r.arrival - ref.arrival)} h).`}
          </p>
        </section>
      )}
    </div>
  );
}

export default function ShipmentDetail({ shipmentId, run, refRun, refName, onClose }) {
  const r = run.result.shipments.find((s) => s.id === shipmentId);
  return (
    <Drawer title={<span className="row">Shipment {shipmentId} {r && <StatusBadge status={r.status} />}</span>} onClose={onClose}>
      <ShipmentDetailBody shipmentId={shipmentId} run={run} refRun={refRun} refName={refName} />
    </Drawer>
  );
}
