import { useMemo } from 'react';
import { ArrowDown, ArrowUp, Minus } from 'lucide-react';
import { compareMetrics, compareShipments } from '../engine/compare.js';
import { fmtNum } from '../utils/format.js';

const fmt = (row, v) => (v === null || v === undefined ? '—' : `${fmtNum(v, row.unit === '%' ? 1 : row.unit === 'h' ? 2 : 0)}${row.unit === '%' ? '%' : row.unit === 'h' ? ' h' : ''}`);

/** Side-by-side headline metrics for two schedule results, with direction-aware deltas (icon + sign, not colour alone). */
export default function MetricComparison({ refRun, run, refName, name }) {
  const rows = useMemo(() => compareMetrics(refRun.result, run.result, compareShipments(refRun.result, run.result)), [refRun, run]);
  return (
    <div className="table-wrap">
      <table className="t">
        <caption className="sr-only">Metric comparison</caption>
        <thead>
          <tr><th>Metric</th><th className="r">{refName}</th><th className="r">{name}</th><th className="r">Change</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const d = r.delta;
            const none = d === null || Math.abs(d) < 1e-9;
            const good = !none && r.betterWhen && ((d > 0) === (r.betterWhen === 'higher'));
            const bad = !none && r.betterWhen && !good;
            return (
              <tr key={r.key}>
                <td>{r.label}</td>
                <td className="r">{fmt(r, r.a)}</td>
                <td className="r">{fmt(r, r.b)}</td>
                <td className="r">
                  <span className={good ? 'pass' : bad ? 'fail' : ''} style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    {none ? <Minus size={13} aria-hidden="true" /> : d > 0 ? <ArrowUp size={13} aria-hidden="true" /> : <ArrowDown size={13} aria-hidden="true" />}
                    {none ? 'no change' : `${d > 0 ? '+' : '−'}${fmt(r, Math.abs(d))}`}
                    {good && <span className="sr-only"> (better)</span>}{bad && <span className="sr-only"> (worse)</span>}
                  </span>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
