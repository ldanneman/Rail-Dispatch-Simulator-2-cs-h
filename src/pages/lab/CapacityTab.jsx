import { useMemo, useState } from 'react';
import { useApp } from '../../state/AppState.jsx';
import CapacityGrid, { CapacityLegend } from '../../components/CapacityGrid.jsx';
import DataTable from '../../components/DataTable.jsx';
import { Banner, Card, NumberField, PriorityBadge, StatusBadge } from '../../components/ui.jsx';
import { HORIZON_HOURS } from '../../engine/constants.js';
import { describeDisruption } from '../../engine/diagnose.js';

const WINDOW = 48;

export default function CapacityTab() {
  const { run, result, input, stale } = useApp();
  const w = result.metrics.operatingWindow;
  const [from, setFrom] = useState(w ? w.start : 0);
  const [to, setTo] = useState(w ? Math.min(w.end, w.start + WINDOW - 1) : WINDOW - 1);
  const [sel, setSel] = useState(null);

  const lo = Math.max(0, Math.min(HORIZON_HOURS - 1, from));
  const hi = Math.max(lo, Math.min(HORIZON_HOURS - 1, to));

  const check = useMemo(() => {
    let slots = 0;
    let violations = 0;
    let usedSlots = 0;
    let maxLoad = 0;
    for (const c of input.connections) {
      for (let h = 0; h < result.horizon; h++) {
        slots += 1;
        const u = result.reservations[c.id][h];
        const cap = result.profiles[c.id].capacity[h];
        if (u > cap) violations += 1;
        if (u > 0) usedSlots += 1;
        if (cap > 0) maxLoad = Math.max(maxLoad, u / cap);
      }
    }
    return { slots, violations, usedSlots, maxLoad };
  }, [input, result]);

  const cell = useMemo(() => {
    if (!sel) return null;
    const c = input.connections.find((x) => x.id === sel.connectionId);
    const p = result.profiles[sel.connectionId];
    const movers = result.shipments.flatMap((s) => s.legs.filter((l) => l.connectionId === sel.connectionId && l.depart === sel.slot).map((l) => ({ ...l, shipmentId: s.id, status: s.status, priority: s.priority })));
    const active = input.disruptions.filter((d) => d.connectionId === sel.connectionId && sel.slot >= d.startHour && sel.slot < d.endHour);
    return { c, movers, cap: p.capacity[sel.slot], tt: p.travelTime[sel.slot], closed: p.closed[sel.slot], active };
  }, [sel, input, result]);

  const shift = (d) => { setFrom((f) => Math.max(0, f + d)); setTo((t) => Math.min(HORIZON_HOURS - 1, t + d)); };

  const moverColumns = [
    { key: 'shipmentId', header: 'Shipment', render: (m) => <span className="mono">{m.shipmentId}</span> },
    { key: 'priority', header: 'Priority', render: (m) => <PriorityBadge priority={m.priority} /> },
    { key: 'path', header: 'Moves', render: (m) => `${m.from} → ${m.to}` },
    { key: 'arrive', header: 'Arrives', align: 'r', render: (m) => `h${m.arrive}` },
    { key: 'status', header: 'Status', render: (m) => <StatusBadge status={m.status} /> },
  ];

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Banner tone={check.violations ? 'error' : 'ok'}>
        <strong>Capacity check:</strong> {check.slots.toLocaleString()} connection-hour slots examined, {check.usedSlots} carry movements, busiest slot at {Math.round(check.maxLoad * 100)}% of its capacity, <strong>{check.violations} slot{check.violations === 1 ? '' : 's'} over capacity</strong>.
        {' '}Capacity means the maximum number of movements <em>entering</em> a connection in one hourly departure slot, whatever the traversal duration; both directions of a connection share it.
      </Banner>
      {stale && <Banner tone="warning">Showing the last calculated schedule; inputs have changed since.</Banner>}
      <Card title="Utilization by hourly slot" actions={<CapacityLegend />}>
        <div className="stack">
          <div className="row" style={{ alignItems: 'flex-end' }}>
            <NumberField label="From slot" value={from} min={0} max={HORIZON_HOURS - 1} onChange={(v) => setFrom(v === '' ? 0 : Number(v))} />
            <NumberField label="To slot" value={to} min={0} max={HORIZON_HOURS - 1} onChange={(v) => setTo(v === '' ? 0 : Number(v))} />
            <button className="btn" onClick={() => shift(-WINDOW)}>◀ Earlier</button>
            <button className="btn" onClick={() => shift(WINDOW)}>Later ▶</button>
            {w && <button className="btn" onClick={() => { setFrom(w.start); setTo(Math.min(w.end, w.start + WINDOW - 1)); }}>Start of activity</button>}
            <button className="btn" onClick={() => { setFrom(0); setTo(HORIZON_HOURS - 1); }}>Full horizon</button>
          </div>
          {hi - lo > 100 && <p className="muted" style={{ margin: 0 }}>Wide range: scroll horizontally. Each column is one departure slot [h, h+1).</p>}
          <CapacityGrid run={run} from={lo} to={hi} selected={sel} onSelect={setSel} />
        </div>
      </Card>
      {cell && (
        <Card title={`${cell.c.id} · slot ${sel.slot} (hours ${sel.slot}–${sel.slot + 1})`} actions={<button className="btn sm" onClick={() => setSel(null)}>Close</button>}>
          <div className="stack">
            <dl className="kv">
              <div><dt>Capacity in this slot</dt><dd>{cell.closed ? '0 (closed)' : cell.cap}{!cell.closed && cell.cap < cell.c.capacity ? ` (base ${cell.c.capacity})` : ''}</dd></div>
              <div><dt>Movements entering</dt><dd>{cell.movers.length}</dd></div>
              <div><dt>Traversal if departing now</dt><dd>{cell.tt} h</dd></div>
            </dl>
            {cell.closed && <Banner tone="info">A closure overlaps [{sel.slot}, {sel.slot + cell.tt}), so nothing may enter this connection in this slot.</Banner>}
            {cell.active.length > 0 && <p className="muted" style={{ margin: 0 }}>Active disruptions: {cell.active.map((d) => `${d.id} (${describeDisruption(d)})`).join('; ')}</p>}
            <div className="card"><DataTable columns={moverColumns} rows={cell.movers} rowKey={(m) => `${m.shipmentId}-${m.index}`} dense empty="No movements enter this connection in this slot." caption="Movements in the selected slot" /></div>
          </div>
        </Card>
      )}
    </div>
  );
}
