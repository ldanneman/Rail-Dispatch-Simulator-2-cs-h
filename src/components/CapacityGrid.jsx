import { useMemo } from 'react';
import { compareIds } from '../engine/ids.js';

/**
 * Connection x hourly-departure-slot grid. Each cell is "movements entering the connection in
 * that slot / capacity in that slot". Values come straight from the scheduler's reservation
 * table and the resolved per-slot capacity profile.
 */
export default function CapacityGrid({ run, from, to, selected, onSelect }) {
  const { result, input } = run;
  const conns = useMemo(() => [...input.connections].sort((a, b) => compareIds(a.id, b.id)), [input]);
  const hours = useMemo(() => Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i), [from, to]);

  return (
    <div className="table-wrap" style={{ maxHeight: '65vh' }}>
      <table className="cap-grid" aria-label="Connection utilization by hourly slot">
        <thead>
          <tr>
            <th className="rowh">Connection</th>
            {hours.map((h) => <th key={h} scope="col" className={h % 24 === 0 ? 'daysep' : ''} title={`Slot ${h}: movements entering in [${h}, ${h + 1})`}>{h}</th>)}
          </tr>
        </thead>
        <tbody>
          {conns.map((c) => {
            const used = result.reservations[c.id];
            const profile = result.profiles[c.id];
            return (
              <tr key={c.id}>
                <th scope="row" className="rowh" title={`${c.from} ${c.bidirectional === false ? '→' : '↔'} ${c.to}, ${c.travelTime} h, capacity ${c.capacity}`}>{c.id} <span className="faint">{c.from}–{c.to}</span></th>
                {hours.map((h) => {
                  const u = h < used.length ? used[h] : 0;
                  const cap = h < used.length ? profile.capacity[h] : c.capacity;
                  const closed = h < used.length && profile.closed[h];
                  const reduced = !closed && cap < c.capacity;
                  const full = !closed && cap > 0 && u === cap;
                  const load = cap > 0 ? u / cap : 0;
                  const isSel = selected && selected.connectionId === c.id && selected.slot === h;
                  const style = !closed && u > 0 ? {
                    background: `color-mix(in srgb, var(--accent) ${25 + load * 70}%, var(--surface))`,
                    color: load > 0.6 ? 'var(--accent-contrast)' : 'var(--text)',
                  } : undefined;
                  const label = closed ? 'closed' : `${u} of ${cap}`;
                  return (
                    <td key={h} className={`${closed ? 'closed' : ''} ${full ? 'full' : ''} ${isSel ? 'sel' : ''} ${h % 24 === 0 ? 'daysep' : ''}`}>
                      <button
                        style={style}
                        onClick={() => onSelect({ connectionId: c.id, slot: h })}
                        aria-label={`${c.id} slot ${h}: ${label}${reduced ? ' (reduced capacity)' : ''}`}
                        title={`${c.id}, slot ${h}: ${closed ? 'closed (a closure overlaps the traversal)' : `${u} movement${u === 1 ? '' : 's'} / capacity ${cap}${reduced ? ` (base ${c.capacity}, reduced)` : ''}`}`}
                      >
                        {closed ? '✕' : cap === 0 ? '–' : u === 0 ? <span className="faint">·{reduced ? '↓' : ''}</span> : `${u}/${cap}`}
                      </button>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

export function CapacityLegend() {
  return (
    <div className="legend">
      <span>Cell = movements entering / capacity in that departure slot</span>
      <span><b>bold</b> = full</span>
      <span>✕ = closed (closure overlaps traversal)</span>
      <span>↓ = capacity reduced by a disruption</span>
    </div>
  );
}
