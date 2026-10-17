import { useMemo, useState } from 'react';
import { compareShipments } from '../engine/compare.js';
import DataTable from './DataTable.jsx';
import { Empty, StatusBadge } from './ui.jsx';

const FLAG_LABEL = {
  rerouted: 'Rerouted',
  retimed: 'Retimed',
  newly_late: 'Newly late',
  newly_undeliverable: 'Newly undeliverable',
  recovered: 'Recovered',
  release_delayed: 'Release delayed',
  added: 'Added',
  removed: 'Removed',
};
const FLAG_TONE = { newly_undeliverable: 'undeliverable', newly_late: 'late', rerouted: 'info', retimed: 'info', recovered: 'on_time', release_delayed: 'warning', added: 'info', removed: 'warning' };

const routeText = (s) => (s && s.routeKey ? s.routeKey.replaceAll('>', ' › ') : '—');
const arrivalText = (s) => (s && s.arrival !== null ? `h${s.arrival}` : '—');

/**
 * What changed for each shipment between two runs: affected, rerouted, arrival changes,
 * newly late / undeliverable, and the reason recorded by the scheduler for each failure.
 */
export default function ImpactReport({ refRun, run, refName, name, onSelectShipment }) {
  const diff = useMemo(() => compareShipments(refRun.result, run.result), [refRun, run]);
  const [filter, setFilter] = useState('affected');
  const s = diff.summary;

  const chips = [
    ['affected', `Affected ${s.affected}`],
    ['rerouted', `Rerouted ${s.rerouted}`],
    ['retimed', `Retimed ${s.retimed}`],
    ['newly_late', `Newly late ${s.newlyLate}`],
    ['newly_undeliverable', `Newly undeliverable ${s.newlyUndeliverable}`],
    ['recovered', `Recovered ${s.recovered}`],
    ['release_delayed', `Release delayed ${s.releaseDelayed}`],
    ['all', `All ${s.total}`],
  ];
  const rows = useMemo(
    () => diff.rows.filter((r) => (filter === 'all' ? true : filter === 'affected' ? r.affected : r.flags.includes(filter))),
    [diff, filter],
  );

  const columns = [
    { key: 'id', header: 'Shipment', render: (r) => <button className="chip" onClick={() => onSelectShipment(r.id)}>{r.id}</button> },
    {
      key: 'flags', header: 'Change', sortValue: (r) => r.flags.join(','),
      render: (r) => (r.flags.length ? <span className="row" style={{ gap: 4 }}>{r.flags.map((f) => <span key={f} className={`badge ${FLAG_TONE[f]}`}>{FLAG_LABEL[f]}</span>)}</span> : <span className="faint">Unchanged</span>),
    },
    {
      key: 'status', header: 'Status', sortValue: (r) => r.b?.status ?? '',
      render: (r) => (
        <span className="row" style={{ gap: 6, flexWrap: 'nowrap' }}>
          {r.a ? <StatusBadge status={r.a.status} /> : '—'}<span aria-hidden="true">→</span>{r.b ? <StatusBadge status={r.b.status} /> : '—'}
        </span>
      ),
    },
    { key: 'arrival', header: 'Arrival', sortValue: (r) => r.b?.arrival ?? null, render: (r) => <span className="nowrap">{arrivalText(r.a)} → {arrivalText(r.b)}</span> },
    {
      key: 'delta', header: 'Δ arrival', align: 'r', sortValue: (r) => r.arrivalDelta,
      render: (r) => (r.arrivalDelta === null ? '—' : r.arrivalDelta === 0 ? '0 h' : `${r.arrivalDelta > 0 ? '+' : '−'}${Math.abs(r.arrivalDelta)} h`),
    },
    { key: 'route', header: 'Route', sortValue: (r) => r.b?.routeKey ?? '', render: (r) => (r.flags.includes('rerouted') ? <span className="mono">{routeText(r.a)} → {routeText(r.b)}</span> : <span className="mono">{routeText(r.b ?? r.a)}</span>) },
    {
      key: 'reason', header: 'Reason', sortable: false,
      render: (r) => r.b?.failure?.message ?? (r.flags.includes('newly_late') ? `Late by ${r.b.lateness} h (${r.b.lateCause?.replaceAll('_', ' ')})` : r.flags.includes('release_delayed') ? `Release moved from h${r.a.effectiveRelease} to h${r.b.effectiveRelease}` : ''),
    },
  ];

  return (
    <div className="stack">
      <p className="muted" style={{ margin: 0 }}>
        Comparing <strong>{name}</strong> against <strong>{refName}</strong>, matching shipments by id. “Affected” means the shipment’s status, route or movement times differ.
      </p>
      <div className="row" role="group" aria-label="Filter impacted shipments">
        {chips.map(([key, label]) => (
          <button key={key} className="btn sm" aria-pressed={filter === key} style={filter === key ? { background: 'var(--accent-soft)', color: 'var(--accent)', borderColor: 'var(--accent)' } : undefined} onClick={() => setFilter(key)}>{label}</button>
        ))}
      </div>
      {rows.length === 0 ? (
        <Empty>{s.affected === 0 ? 'No shipment differs between these two scenarios.' : 'No shipments match this filter.'}</Empty>
      ) : (
        <div className="card"><DataTable columns={columns} rows={rows} pageSize={25} dense caption="Shipment impact" /></div>
      )}
    </div>
  );
}
