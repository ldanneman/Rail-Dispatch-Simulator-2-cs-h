import { useMemo } from 'react';

const W = 1000;
const PAD_X = 80;
const PAD_Y = 75;
const NODE_R = 21;

export function layoutMap(terminals, connections) {
  const xs = terminals.map((t) => t.x);
  const ys = terminals.map((t) => t.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const xr = maxX - minX;
  const yr = maxY - minY;
  const H = terminals.length === 0 ? 300 : Math.max(280, Math.min(560, W * (yr / (xr || 1)) + 170));
  const pos = new Map();
  for (const t of terminals) {
    pos.set(t.id, {
      x: xr === 0 ? W / 2 : PAD_X + ((t.x - minX) / xr) * (W - 2 * PAD_X),
      y: yr === 0 ? H / 2 : PAD_Y + ((t.y - minY) / yr) * (H - 2 * PAD_Y),
    });
  }
  // Parallel connections between the same pair of terminals are drawn side by side.
  const groups = new Map();
  for (const c of connections) {
    const key = [c.from, c.to].sort().join('|');
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(c.id);
  }
  const edges = new Map();
  for (const c of connections) {
    const a = pos.get(c.from);
    const b = pos.get(c.to);
    if (!a || !b) continue;
    const group = groups.get([c.from, c.to].sort().join('|'));
    const idx = group.indexOf(c.id);
    const off = (idx - (group.length - 1) / 2) * 18;
    const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
    const nx = ((b.y - a.y) / len) * off;
    const ny = (-(b.x - a.x) / len) * off;
    edges.set(c.id, {
      x1: a.x + nx, y1: a.y + ny, x2: b.x + nx, y2: b.y + ny,
      mx: (a.x + b.x) / 2 + nx, my: (a.y + b.y) / 2 + ny,
    });
  }
  // Labels sit at the midpoint, unless another label is already close; then slide along the edge.
  const placed = [];
  for (const c of connections) {
    const e = edges.get(c.id);
    if (!e) continue;
    for (const t of [0.5, 0.3, 0.7, 0.2, 0.8]) {
      const lx = e.x1 + (e.x2 - e.x1) * t;
      const ly = e.y1 + (e.y2 - e.y1) * t;
      if (placed.every((p) => Math.hypot(p.x - lx, p.y - ly) > 46) || t === 0.8) {
        e.mx = lx;
        e.my = ly;
        placed.push({ x: lx, y: ly });
        break;
      }
    }
  }
  return { H, pos, edges };
}

/**
 * Network overview / route visualisation.
 *  metrics        schedule metrics (colours edges by utilisation, shows terminal throughput)
 *  highlightLegs  legs of one shipment to draw as a numbered route
 *  movements      [{ key, label, connectionId, from, to, progress }] in-flight markers (playback)
 *  waiting        { [terminalId]: count } shipments waiting at a terminal (playback)
 */
export default function NetworkMap({
  terminals,
  connections,
  disruptions = [],
  metrics = null,
  highlightLegs = null,
  movements = null,
  waiting = null,
  onSelectTerminal,
  onSelectConnection,
  selectedConnectionId = null,
  label = 'Rail network map',
}) {
  const { H, pos, edges } = useMemo(() => layoutMap(terminals, connections), [terminals, connections]);
  const connStats = useMemo(() => new Map((metrics?.connections ?? []).map((c) => [c.id, c])), [metrics]);
  const termStats = useMemo(() => new Map((metrics?.terminals ?? []).map((t) => [t.id, t])), [metrics]);
  const disrupted = useMemo(() => {
    const m = new Map();
    for (const d of disruptions) if (d.connectionId) m.set(d.connectionId, [...(m.get(d.connectionId) ?? []), d]);
    return m;
  }, [disruptions]);
  const dim = Boolean(highlightLegs);
  const onRoute = new Set((highlightLegs ?? []).map((l) => l.connectionId));

  return (
    <div className="map-wrap">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={label}>
        <defs>
          <marker id="arrow-route" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--accent)" />
          </marker>
          <marker id="arrow-edge" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto-start-reverse">
            <path d="M0 0 L10 5 L0 10 z" fill="var(--text-3)" />
          </marker>
        </defs>

        {connections.map((c) => {
          const e = edges.get(c.id);
          if (!e) return null;
          const st = connStats.get(c.id);
          const u = st ? Math.min(1, st.utilization) : 0;
          const used = st && st.movements > 0;
          const stroke = used ? `color-mix(in srgb, var(--accent) ${25 + u * 75}%, var(--grid))` : 'var(--grid)';
          const dis = disrupted.get(c.id);
          const selected = selectedConnectionId === c.id;
          return (
            <g key={c.id} opacity={dim && !onRoute.has(c.id) ? 0.28 : 1}
              onClick={onSelectConnection ? () => onSelectConnection(c.id) : undefined}
              style={onSelectConnection ? { cursor: 'pointer' } : undefined}>
              <title>{`${c.id}: ${c.from} ${c.bidirectional === false ? '→' : '↔'} ${c.to}, ${c.travelTime} h, capacity ${c.capacity}/h${st ? `, ${st.movements} movements, peak load ${Math.round(st.peakLoad * 100)}%` : ''}${dis ? `, disrupted: ${dis.map((d) => d.type).join(', ')}` : ''}`}</title>
              {selected && <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--accent)" strokeWidth={16} opacity={0.18} strokeLinecap="round" />}
              <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke={stroke} strokeWidth={2.5 + Math.min(c.capacity, 4) * 1.4} strokeLinecap="round"
                markerEnd={c.bidirectional === false ? 'url(#arrow-edge)' : undefined} />
              {dis && <line x1={e.x1} y1={e.y1} x2={e.x2} y2={e.y2} stroke="var(--critical)" strokeWidth={3} strokeDasharray="3 9" strokeLinecap="round" />}
              <text x={e.mx} y={e.my - 7} textAnchor="middle" fontSize="12" className="halo t2" fontWeight="600">
                {c.id}{dis ? ' ⚠' : ''}
              </text>
              <text x={e.mx} y={e.my + 9} textAnchor="middle" fontSize="11" className="halo t3">
                {c.travelTime}h · cap {c.capacity}
              </text>
            </g>
          );
        })}

        {highlightLegs?.map((leg, i) => {
          const e = edges.get(leg.connectionId);
          const a = pos.get(leg.from);
          const b = pos.get(leg.to);
          if (!e || !a || !b) return null;
          // Draw in travel direction along the (possibly offset) edge.
          const forward = Math.hypot(e.x1 - a.x, e.y1 - a.y) <= Math.hypot(e.x2 - a.x, e.y2 - a.y);
          const [x1, y1, x2, y2] = forward ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
          const sx = x1 + (x2 - x1) * 0.16;
          const sy = y1 + (y2 - y1) * 0.16;
          const ex = x1 + (x2 - x1) * 0.84;
          const ey = y1 + (y2 - y1) * 0.84;
          return (
            <g key={`${leg.connectionId}-${i}`}>
              <line x1={sx} y1={sy} x2={ex} y2={ey} stroke="var(--accent)" strokeWidth={5} strokeLinecap="round" markerEnd="url(#arrow-route)" />
              <circle cx={(x1 + x2) / 2} cy={(y1 + y2) / 2 + 22} r={10} fill="var(--accent)" />
              <text x={(x1 + x2) / 2} y={(y1 + y2) / 2 + 26} textAnchor="middle" fontSize="12" fontWeight="700" style={{ fill: 'var(--accent-contrast)' }}>{i + 1}</text>
            </g>
          );
        })}

        {terminals.map((t) => {
          const p = pos.get(t.id);
          const st = termStats.get(t.id);
          const involved = !highlightLegs || highlightLegs.some((l) => l.from === t.id || l.to === t.id);
          const w = waiting?.[t.id] ?? 0;
          return (
            <g key={t.id} opacity={involved ? 1 : 0.4} tabIndex={onSelectTerminal ? 0 : undefined}
              onClick={onSelectTerminal ? () => onSelectTerminal(t.id) : undefined}
              onKeyDown={onSelectTerminal ? (e) => e.key === 'Enter' && onSelectTerminal(t.id) : undefined}
              style={onSelectTerminal ? { cursor: 'pointer' } : undefined}>
              <title>{`${t.id} ${t.name}${st ? ` — ${st.departures} departures, ${st.arrivals} arrivals` : ''}`}</title>
              <circle cx={p.x} cy={p.y} r={NODE_R} fill="var(--surface)" stroke="var(--accent)" strokeWidth={3} />
              <text x={p.x} y={p.y + 4.5} textAnchor="middle" fontSize="13" fontWeight="700">{t.id.length > 4 ? t.id.slice(0, 4) : t.id}</text>
              <text x={p.x} y={p.y + NODE_R + 17} textAnchor="middle" fontSize="12.5" fontWeight="550" className="halo">{t.name}</text>
              {st && (
                <text x={p.x} y={p.y + NODE_R + 32} textAnchor="middle" fontSize="11.5" className="halo t3">
                  ↑{st.departures} ↓{st.arrivals}
                </text>
              )}
              {w > 0 && (
                <g>
                  <circle cx={p.x + NODE_R - 2} cy={p.y - NODE_R + 2} r={10} fill="var(--late)" />
                  <text x={p.x + NODE_R - 2} y={p.y - NODE_R + 6} textAnchor="middle" fontSize="11" fontWeight="700" style={{ fill: '#0b0b0b' }}>{w}</text>
                </g>
              )}
            </g>
          );
        })}

        {movements?.map((m) => {
          const e = edges.get(m.connectionId);
          const a = pos.get(m.from);
          if (!e || !a) return null;
          const forward = Math.hypot(e.x1 - a.x, e.y1 - a.y) <= Math.hypot(e.x2 - a.x, e.y2 - a.y);
          const [x1, y1, x2, y2] = forward ? [e.x1, e.y1, e.x2, e.y2] : [e.x2, e.y2, e.x1, e.y1];
          const cx = x1 + (x2 - x1) * m.progress;
          const cy = y1 + (y2 - y1) * m.progress;
          return (
            <g key={m.key}>
              <title>{m.label}</title>
              <circle cx={cx} cy={cy} r={6.5} fill="var(--accent)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          );
        })}
      </svg>
    </div>
  );
}
