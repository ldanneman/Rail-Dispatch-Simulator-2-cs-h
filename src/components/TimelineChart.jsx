import { useMemo } from 'react';
import { DISRUPTION, HORIZON_HOURS } from '../engine/constants.js';
import { compareIds } from '../engine/ids.js';
import { Empty } from './ui.jsx';

const LANE_H = 17;
const BAR_H = 13;
const SHIP_ROW_H = 24;
const AXIS_H = 34;
const STATUS_FILL = { on_time: 'var(--good)', late: 'var(--late)', undeliverable: 'var(--critical)' };

export function timelineRange(shipments, full) {
  if (full) return [0, HORIZON_HOURS];
  let min = Infinity;
  let max = -Infinity;
  for (const s of shipments) for (const l of s.legs) {
    min = Math.min(min, l.depart, s.effectiveRelease);
    max = Math.max(max, l.arrive);
  }
  if (min === Infinity) return [0, 48];
  return [Math.floor(min / 24) * 24, Math.max(Math.ceil(max / 24) * 24, Math.floor(min / 24) * 24 + 24)];
}

function assignLanes(items) {
  const sorted = [...items].sort((a, b) => a.leg.depart - b.leg.depart || a.leg.arrive - b.leg.arrive || compareIds(a.shipment.id, b.shipment.id));
  const laneEnds = [];
  const placed = [];
  for (const it of sorted) {
    let lane = laneEnds.findIndex((end) => end <= it.leg.depart);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(0);
    }
    laneEnds[lane] = it.leg.arrive;
    placed.push({ ...it, lane });
  }
  return { placed, lanes: Math.max(1, laneEnds.length) };
}

function Axis({ start, end, px, width }) {
  const step = px >= 14 ? 3 : px >= 8 ? 6 : 12;
  const ticks = [];
  for (let h = start; h <= end; h += 1) if (h % step === 0) ticks.push(h);
  return (
    <g>
      {ticks.map((h) => {
        const x = (h - start) * px;
        const day = h % 24 === 0;
        return (
          <g key={h}>
            <line x1={x} x2={x} y1={day ? 0 : 20} y2={AXIS_H} stroke={day ? 'var(--text-3)' : 'var(--grid)'} />
            <text x={x + 3} y={31} fontSize="10.5" className="t3">{h}</text>
            {day && <text x={x + 3} y={12} fontSize="11" fontWeight="650" className="t2">Day {Math.floor(h / 24) + 1}</text>}
          </g>
        );
      })}
    </g>
  );
}

/**
 * Timeline of scheduled movements.
 *  mode 'connection': one row per connection, overlapping movements stacked in lanes,
 *                     disruption windows drawn as bands behind the bars.
 *  mode 'shipment'  : one row per shipment: release tick, waiting (dashed), movements, deadline diamond.
 */
export default function TimelineChart({ shipments, connections, disruptions = [], mode, px = 10, fullRange = false, clock = null, onSelectShipment }) {
  const [start, end] = useMemo(() => timelineRange(shipments, fullRange), [shipments, fullRange]);
  const width = (end - start) * px + 24;
  const x = (h) => (h - start) * px;

  const layout = useMemo(() => {
    if (mode === 'connection') {
      const sortedConns = [...connections].sort((a, b) => compareIds(a.id, b.id));
      const byConn = new Map(sortedConns.map((c) => [c.id, []]));
      for (const s of shipments) for (const leg of s.legs) byConn.get(leg.connectionId)?.push({ shipment: s, leg });
      let y = 0;
      const rows = sortedConns.map((c) => {
        const { placed, lanes } = assignLanes(byConn.get(c.id));
        const h = lanes * LANE_H + 10;
        const row = { id: c.id, label: `${c.id} ${c.from}–${c.to}`, y, h, items: placed, lanes };
        y += h;
        return row;
      });
      return { rows, height: y };
    }
    const rows = shipments.map((s, i) => ({ id: s.id, label: s.id, y: i * SHIP_ROW_H, h: SHIP_ROW_H, s }));
    return { rows, height: rows.length * SHIP_ROW_H };
  }, [mode, shipments, connections]);

  const hasAny = shipments.some((s) => s.legs.length);
  if (!hasAny) return <Empty>No scheduled movements match the current filters.</Empty>;

  return (
    <div className="tl">
      <div className="tl-labels" aria-hidden="true">
        <div style={{ height: AXIS_H, borderBottom: '1px solid var(--border)' }} />
        {layout.rows.map((r) => <div key={r.id} className="tl-label" style={{ height: r.h }}>{r.label}</div>)}
      </div>
      <div className="tl-scroll">
        <svg width={width} height={AXIS_H + layout.height + 4} role="img" aria-label={`Timeline of scheduled movements by ${mode}`}>
          <defs>
            <pattern id="hatch-closure" width="7" height="7" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
              <rect width="7" height="7" fill="var(--critical)" opacity="0.10" />
              <line x1="0" y1="0" x2="0" y2="7" stroke="var(--critical)" strokeWidth="2.5" opacity="0.55" />
            </pattern>
          </defs>
          <Axis start={start} end={end} px={px} width={width} />
          <g transform={`translate(0 ${AXIS_H})`}>
            {layout.rows.map((r) => (
              <g key={r.id} transform={`translate(0 ${r.y})`}>
                <line x1={0} x2={width} y1={r.h} y2={r.h} stroke="var(--grid)" />
                {mode === 'connection' && disruptions.filter((d) => d.connectionId === r.id).map((d) => {
                  const closure = d.type === DISRUPTION.CLOSURE;
                  return (
                    <g key={d.id}>
                      <title>{`${d.id}: ${d.type.replace('_', ' ')} [${d.startHour}, ${d.endHour})`}</title>
                      <rect x={x(Math.max(d.startHour, start))} y={1} width={Math.max(0, (Math.min(d.endHour, end) - Math.max(d.startHour, start)) * px)} height={r.h - 2}
                        fill={closure ? 'url(#hatch-closure)' : 'var(--warn)'} opacity={closure ? 1 : 0.18} stroke={closure ? 'var(--critical)' : 'var(--warn)'} strokeDasharray="3 3" />
                    </g>
                  );
                })}
                {mode === 'connection' && r.items.map(({ shipment: s, leg, lane }) => (
                  <g key={`${s.id}-${leg.index}`} onClick={() => onSelectShipment?.(s.id)} style={{ cursor: 'pointer' }}>
                    <title>{`${s.id} on ${leg.connectionId} (${leg.from}→${leg.to}): departs h${leg.depart}, arrives h${leg.arrive}${leg.waitBefore ? `, waited ${leg.waitBefore} h` : ''} — ${s.status.replace('_', ' ')}`}</title>
                    <rect x={x(leg.depart)} y={5 + lane * LANE_H} width={Math.max(2, (leg.arrive - leg.depart) * px - 1)} height={BAR_H} rx={3} fill={STATUS_FILL[s.status]} stroke="var(--surface)" />
                    {(leg.arrive - leg.depart) * px >= 38 && <text x={x(leg.depart) + 4} y={5 + lane * LANE_H + 10} fontSize="10" style={{ fill: '#0b0b0b' }}>{s.id}</text>}
                  </g>
                ))}
                {mode === 'shipment' && (() => {
                  const s = r.s;
                  const cy = r.h / 2;
                  let ready = s.effectiveRelease;
                  return (
                    <g onClick={() => onSelectShipment?.(s.id)} style={{ cursor: 'pointer' }}>
                      <title>{`${s.id}: released h${s.effectiveRelease}, deadline h${s.deadline}, ${s.arrival !== null ? `delivered h${s.arrival}` : 'undeliverable'}`}</title>
                      <rect x={0} y={0} width={width} height={r.h} fill="transparent" />
                      <line x1={x(s.effectiveRelease)} x2={x(s.effectiveRelease)} y1={cy - 8} y2={cy + 8} stroke="var(--text-2)" strokeWidth={2} />
                      {s.legs.map((l) => {
                        const wait = l.depart > ready ? <line key={`w${l.index}`} x1={x(ready)} x2={x(l.depart)} y1={cy} y2={cy} stroke="var(--text-3)" strokeDasharray="3 3" strokeWidth={1.5} /> : null;
                        ready = l.arrive;
                        return (
                          <g key={l.index}>
                            {wait}
                            <rect x={x(l.depart)} y={cy - 7} width={Math.max(2, (l.arrive - l.depart) * px - 1)} height={14} rx={3} fill={STATUS_FILL[s.status]} stroke="var(--surface)" />
                            {(l.arrive - l.depart) * px >= 30 && <text x={x(l.depart) + 4} y={cy + 3.5} fontSize="10" style={{ fill: '#0b0b0b' }}>{l.connectionId}</text>}
                          </g>
                        );
                      })}
                      {s.deadline >= start && s.deadline <= end && <path d={`M${x(s.deadline)} ${cy - 8} l5 8 l-5 8 l-5 -8 z`} fill="var(--surface)" stroke="var(--text)" strokeWidth={1.5} />}
                    </g>
                  );
                })()}
              </g>
            ))}
            {clock !== null && clock >= start && clock <= end && (
              <g pointerEvents="none">
                <line x1={x(clock)} x2={x(clock)} y1={-AXIS_H + 14} y2={layout.height} stroke="var(--accent)" strokeWidth={2} />
                <text x={x(clock) + 4} y={-AXIS_H + 24} fontSize="11" fontWeight="700" style={{ fill: 'var(--accent)' }}>h{clock}</text>
              </g>
            )}
          </g>
        </svg>
      </div>
    </div>
  );
}

export function TimelineLegend({ mode }) {
  return (
    <div className="legend" aria-label="Timeline legend">
      <span><i className="sw on_time" />On time</span>
      <span><i className="sw late" />Late</span>
      {mode === 'shipment' && <span>▏release · ┄ waiting · ◇ deadline</span>}
      {mode === 'connection' && <span><i className="sw" style={{ background: 'repeating-linear-gradient(45deg, var(--critical) 0 2px, transparent 2px 5px)', border: '1px dashed var(--critical)' }} />Closure window</span>}
      {mode === 'connection' && <span><i className="sw" style={{ background: 'var(--warn)', opacity: 0.4 }} />Travel-time / capacity disruption</span>}
    </div>
  );
}
