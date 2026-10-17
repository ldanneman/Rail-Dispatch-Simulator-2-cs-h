import DataTable from './DataTable.jsx';
import { fmtNum, fmtRatioPct } from '../utils/format.js';

const Meter = ({ value, label }) => (
  <div className="row" style={{ gap: 8, flexWrap: 'nowrap' }}>
    <div className="bar" style={{ width: 90 }} role="img" aria-label={label}><span style={{ width: `${Math.min(100, value * 100)}%` }} /></div>
    <span className="num" style={{ minWidth: 38 }}>{fmtRatioPct(value)}</span>
  </div>
);

/** Connection utilisation and bottleneck columns, derived from result.metrics.connections. */
export function ConnectionUtilizationTable({ metrics, onSelect, selectedId }) {
  const columns = [
    { key: 'id', header: 'Connection', render: (c) => <span className="mono">{c.id}</span> },
    { key: 'link', header: 'Link', sortValue: (c) => `${c.from}${c.to}`, render: (c) => `${c.from}–${c.to}` },
    { key: 'movements', header: 'Movements', align: 'r' },
    { key: 'utilization', header: 'Utilization', render: (c) => <Meter value={c.utilization} label={`${c.id} utilization ${fmtRatioPct(c.utilization)}`} /> },
    { key: 'peakLoad', header: 'Peak slot load', align: 'r', render: (c) => fmtRatioPct(c.peakLoad) },
    { key: 'saturatedSlots', header: 'Full slots', align: 'r' },
    { key: 'queuedHours', header: 'Queued (h)', align: 'r' },
    { key: 'closedSlots', header: 'Closed slots', align: 'r' },
  ];
  return (
    <DataTable columns={columns} rows={metrics.connections} initialSort={{ key: 'utilization', dir: -1 }} dense onRowClick={onSelect ? (c) => onSelect(c.id) : undefined} selectedKey={selectedId} caption="Connection utilization" />
  );
}

/** Throughput (not %): arrivals and departures per terminal, as the spec requires without terminal handling capacities. */
export function TerminalThroughputTable({ metrics }) {
  const columns = [
    { key: 'id', header: 'Terminal', render: (t) => <span><span className="mono">{t.id}</span> {t.name}</span>, sortValue: (t) => t.id },
    { key: 'departures', header: 'Departures', align: 'r' },
    { key: 'arrivals', header: 'Arrivals', align: 'r' },
    { key: 'originated', header: 'Shipped out', align: 'r' },
    { key: 'delivered', header: 'Delivered here', align: 'r' },
    { key: 'transfers', header: 'Transfers', align: 'r', render: (t) => fmtNum(t.transfers, 0) },
  ];
  return <DataTable columns={columns} rows={metrics.terminals} initialSort={{ key: 'departures', dir: -1 }} dense caption="Terminal throughput" />;
}
