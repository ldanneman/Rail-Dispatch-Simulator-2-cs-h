import { SeverityIcon, ShipmentChips, Empty } from './ui.jsx';

export default function AlertsPanel({ alerts, onSelectShipment, onSelectConnection, limit }) {
  const shown = limit ? alerts.slice(0, limit) : alerts;
  if (!alerts.length) return <Empty>No operational alerts: every shipment is on time and no bottlenecks were detected.</Empty>;
  return (
    <div role="list" aria-label="Operational alerts">
      {shown.map((a) => (
        <div key={a.id} className={`alert ${a.severity}`} role="listitem">
          <SeverityIcon severity={a.severity} />
          <div>
            <strong>{a.title}</strong>
            <div className="muted">{a.detail}</div>
            <ShipmentChips ids={a.shipmentIds} onSelect={onSelectShipment} max={10} />
            {a.connectionIds.length > 0 && a.kind !== 'disruption' && onSelectConnection && (
              <div className="chips">{a.connectionIds.map((id) => <button key={id} className="chip" onClick={() => onSelectConnection(id)}>{id}</button>)}</div>
            )}
          </div>
        </div>
      ))}
      {limit && alerts.length > limit && <div className="pager">{alerts.length - limit} more alerts not shown</div>}
    </div>
  );
}
