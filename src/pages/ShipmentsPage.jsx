import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import { useApp, useReference } from '../state/AppState.jsx';
import { PRIORITIES, STATUS } from '../engine/constants.js';
import DataTable from '../components/DataTable.jsx';
import ShipmentDetail from '../components/ShipmentDetail.jsx';
import { Card, Field, PriorityBadge, StatusBadge } from '../components/ui.jsx';
import { STATUS_LABEL } from '../utils/format.js';

export default function ShipmentsPage() {
  const { scenario, run, input, result } = useApp();
  const ref = useReference();
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const [priority, setPriority] = useState('all');
  const [origin, setOrigin] = useState('all');
  const [destination, setDestination] = useState('all');
  const [selected, setSelected] = useState(null);

  const cargo = useMemo(() => new Map(input.shipments.map((s) => [s.id, s.cargo ?? ''])), [input]);
  const rows = useMemo(() => result.shipments.map((s) => ({ ...s, cargo: cargo.get(s.id) })), [result, cargo]);
  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (status !== 'all' && r.status !== status) return false;
      if (priority !== 'all' && r.priority !== Number(priority)) return false;
      if (origin !== 'all' && r.origin !== origin) return false;
      if (destination !== 'all' && r.destination !== destination) return false;
      if (!q) return true;
      return [r.id, r.origin, r.destination, r.cargo, r.routeKey, r.failure?.message, STATUS_LABEL[r.status]].some((v) => v && String(v).toLowerCase().includes(q));
    });
  }, [rows, query, status, priority, origin, destination]);

  const terminalOptions = [{ value: 'all', label: 'Any' }, ...input.terminals.map((t) => ({ value: t.id, label: `${t.id} ${t.name}` }))];
  const columns = [
    { key: 'id', header: 'ID', render: (r) => <span className="mono">{r.id}</span> },
    { key: 'cargo', header: 'Cargo' },
    { key: 'origin', header: 'From' },
    { key: 'destination', header: 'To' },
    { key: 'priority', header: 'Priority', render: (r) => <PriorityBadge priority={r.priority} /> },
    { key: 'release', header: 'Release', align: 'r', render: (r) => (r.effectiveRelease !== r.release ? <span title={`delayed from h${r.release}`}>h{r.effectiveRelease}*</span> : `h${r.release}`), sortValue: (r) => r.effectiveRelease },
    { key: 'deadline', header: 'Deadline', align: 'r', render: (r) => `h${r.deadline}` },
    { key: 'departure', header: 'Departs', align: 'r', render: (r) => (r.departure === null ? '—' : `h${r.departure}`) },
    { key: 'arrival', header: 'Delivered', align: 'r', render: (r) => (r.arrival === null ? '—' : `h${r.arrival}`) },
    { key: 'lateness', header: 'Late by', align: 'r', render: (r) => (r.lateness === null ? '—' : r.lateness ? `${r.lateness} h` : '0') },
    { key: 'waitHours', header: 'Waited', align: 'r', render: (r) => (r.waitHours === null ? '—' : `${r.waitHours} h`) },
    { key: 'status', header: 'Status', render: (r) => <StatusBadge status={r.status} /> },
    { key: 'routeKey', header: 'Route', render: (r) => (r.routeKey ? <span className="mono">{r.routeKey.replaceAll('>', ' › ')}</span> : <span className="faint" title={r.failure?.message}>{r.failure ? 'no route' : ''}</span>) },
  ];

  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Shipments</h1>
          <p>{scenario.name}. Search, sort and filter every shipment; select a row to see its route, per-connection schedule and waiting.</p>
        </div>
      </div>
      <Card>
        <div className="form-grid">
          <Field label="Search"><span style={{ position: 'relative', display: 'block' }}><Search size={14} style={{ position: 'absolute', left: 9, top: 11, opacity: 0.5 }} aria-hidden="true" /><input type="search" style={{ paddingLeft: 28 }} placeholder="ID, terminal, cargo, route, reason…" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search shipments" /></span></Field>
          <Field label="Status">
            <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Filter by status">
              <option value="all">Any</option>
              {Object.values(STATUS).map((s) => <option key={s} value={s}>{STATUS_LABEL[s]}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <select value={priority} onChange={(e) => setPriority(e.target.value)} aria-label="Filter by priority">
              <option value="all">Any</option>
              {PRIORITIES.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </Field>
          <Field label="Origin"><select value={origin} onChange={(e) => setOrigin(e.target.value)} aria-label="Filter by origin">{terminalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
          <Field label="Destination"><select value={destination} onChange={(e) => setDestination(e.target.value)} aria-label="Filter by destination">{terminalOptions.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}</select></Field>
          <button className="btn" onClick={() => { setQuery(''); setStatus('all'); setPriority('all'); setOrigin('all'); setDestination('all'); }}>Clear filters</button>
        </div>
      </Card>
      <Card flush title={`Showing ${filtered.length} of ${rows.length}`} actions={<span className="muted">* release delayed by a disruption</span>}>
        <DataTable columns={columns} rows={filtered} pageSize={25} onRowClick={(r) => setSelected(r.id)} selectedKey={selected} initialSort={{ key: 'id', dir: 1 }} empty="No shipments match these filters." caption="Shipments" />
      </Card>
      {selected && <ShipmentDetail shipmentId={selected} run={run} refRun={ref?.run} refName={ref?.name} onClose={() => setSelected(null)} />}
    </main>
  );
}
