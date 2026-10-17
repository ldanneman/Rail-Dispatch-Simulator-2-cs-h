import { useMemo, useState } from 'react';
import { Download } from 'lucide-react';
import DataTable from './DataTable.jsx';
import { ShipmentDetailBody } from './ShipmentDetail.jsx';
import { Card, Segmented, StatusBadge } from './ui.jsx';
import { scheduleToCsv } from '../data/serialization.js';
import { downloadText } from '../utils/download.js';

/** Inspect any shipment's full schedule, or list every movement the scheduler produced. */
export default function ScheduleInspector({ run, refRun, refName, scenarioName }) {
  const [mode, setMode] = useState('shipment');
  const [selected, setSelected] = useState(run.result.shipments[0]?.id ?? null);
  const [query, setQuery] = useState('');
  const { result } = run;

  const shipmentRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.shipments.filter((s) => !q || [s.id, s.origin, s.destination, s.status].some((v) => String(v).toLowerCase().includes(q)));
  }, [result, query]);

  const movementRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return result.shipments
      .flatMap((s) => s.legs.map((l) => ({ ...l, key: `${s.id}-${l.index}`, shipmentId: s.id, status: s.status, priority: s.priority })))
      .filter((m) => !q || [m.shipmentId, m.connectionId, m.from, m.to].some((v) => String(v).toLowerCase().includes(q)));
  }, [result, query]);

  const shipmentColumns = [
    { key: 'id', header: 'Shipment', render: (s) => <span className="mono">{s.id}</span> },
    { key: 'route', header: 'Route', sortValue: (s) => `${s.origin}${s.destination}`, render: (s) => `${s.origin}→${s.destination}` },
    { key: 'status', header: 'Status', render: (s) => <StatusBadge status={s.status} /> },
    { key: 'arrival', header: 'Delivered', align: 'r', render: (s) => (s.arrival === null ? '—' : `h${s.arrival}`) },
  ];
  const movementColumns = [
    { key: 'shipmentId', header: 'Shipment', render: (m) => <span className="mono">{m.shipmentId}</span> },
    { key: 'index', header: 'Leg', align: 'r', render: (m) => m.index + 1 },
    { key: 'connectionId', header: 'Connection' },
    { key: 'path', header: 'From → To', sortValue: (m) => `${m.from}${m.to}`, render: (m) => `${m.from} → ${m.to}` },
    { key: 'waitBefore', header: 'Waited (h)', align: 'r' },
    { key: 'depart', header: 'Departs', align: 'r', render: (m) => `h${m.depart}` },
    { key: 'travelTime', header: 'Travel (h)', align: 'r' },
    { key: 'arrive', header: 'Arrives', align: 'r', render: (m) => `h${m.arrive}` },
    { key: 'status', header: 'Shipment status', render: (m) => <StatusBadge status={m.status} /> },
  ];

  return (
    <Card
      title="Detailed schedule"
      actions={
        <>
          <Segmented label="Schedule view" value={mode} onChange={setMode} options={[{ value: 'shipment', label: 'By shipment' }, { value: 'movements', label: 'All movements' }]} />
          <button className="btn sm" onClick={() => downloadText(`schedule-${scenarioName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.csv`, scheduleToCsv(result), 'text/csv')}><Download size={14} aria-hidden="true" />CSV</button>
        </>
      }
    >
      <div className="stack">
        <input type="search" placeholder="Filter by shipment, connection or terminal…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter schedule" style={{ maxWidth: 360 }} />
        {mode === 'shipment' ? (
          <div className="grid" style={{ gridTemplateColumns: 'minmax(260px, 1fr) minmax(0, 2fr)', alignItems: 'start' }}>
            <div className="card"><DataTable columns={shipmentColumns} rows={shipmentRows} pageSize={12} dense selectedKey={selected} onRowClick={(s) => setSelected(s.id)} caption="Shipments" /></div>
            <div>{selected ? <ShipmentDetailBody shipmentId={selected} run={run} refRun={refRun} refName={refName} /> : <p className="muted">Select a shipment.</p>}</div>
          </div>
        ) : (
          <div className="card"><DataTable columns={movementColumns} rows={movementRows} rowKey={(m) => m.key} pageSize={25} dense caption="All scheduled movements" empty="No movements." /></div>
        )}
      </div>
    </Card>
  );
}
