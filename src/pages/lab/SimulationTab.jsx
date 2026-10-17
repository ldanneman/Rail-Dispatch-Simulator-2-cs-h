import { useEffect, useMemo, useState } from 'react';
import { Pause, Play, RefreshCw, RotateCcw, SkipBack, StepBack, StepForward } from 'lucide-react';
import { useApp, useReference } from '../../state/AppState.jsx';
import { snapshotAt } from '../../engine/playback.js';
import NetworkMap from '../../components/NetworkMap.jsx';
import TimelineChart, { TimelineLegend } from '../../components/TimelineChart.jsx';
import ScheduleInspector from '../../components/ScheduleInspector.jsx';
import ExpectationsPanel from '../../components/ExpectationsPanel.jsx';
import VerificationPanel from '../../components/VerificationPanel.jsx';
import { Banner, Card, useConfirm } from '../../components/ui.jsx';
import { dayLabel } from '../../utils/format.js';

export default function SimulationTab() {
  const { scenario, run, result, input, stale, dispatch, state } = useApp();
  const ref = useReference();
  const [confirm, dialog] = useConfirm();
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);

  const [startHour, endHour] = useMemo(() => {
    const routed = result.shipments.filter((s) => s.arrival !== null);
    if (!routed.length) return [0, 0];
    return [Math.min(...routed.map((s) => s.effectiveRelease)), Math.max(...routed.map((s) => s.arrival))];
  }, [result]);
  const [clock, setClock] = useState(startHour);

  // Keep the clock inside the range of the current schedule (e.g. after a recalculation).
  useEffect(() => { setClock((c) => Math.min(Math.max(c, startHour), endHour)); }, [startHour, endHour]);

  useEffect(() => {
    if (!playing) return undefined;
    const id = setInterval(() => {
      setClock((c) => {
        if (c >= endHour) {
          setPlaying(false);
          return c;
        }
        return c + 1;
      });
    }, 1000 / speed);
    return () => clearInterval(id);
  }, [playing, speed, endHour]);

  const snap = useMemo(() => snapshotAt(result, clock), [result, clock]);
  const total = result.shipments.length;

  const runNow = () => {
    dispatch({ type: 'scenario/run', id: scenario.id });
    setClock(startHour);
    setPlaying(true);
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Simulation controls">
        <div className="stack">
          <div className="row" style={{ gap: 8 }}>
            <button className="btn primary" onClick={runNow}><Play size={15} aria-hidden="true" />Run simulation</button>
            <button className="btn" onClick={() => setPlaying((p) => !p)} disabled={endHour === 0 || (!playing && clock >= endHour)}>{playing ? <><Pause size={15} aria-hidden="true" />Pause</> : <><Play size={15} aria-hidden="true" />Resume</>}</button>
            <button className="btn" onClick={() => { setPlaying(false); setClock(startHour); }}><SkipBack size={15} aria-hidden="true" />Rewind</button>
            <button className="btn" onClick={() => dispatch({ type: 'scenario/run', id: scenario.id })}><RefreshCw size={15} aria-hidden="true" />Recalculate</button>
            <button className="btn danger" disabled={scenario.locked}
              onClick={() => confirm({ title: 'Reset scenario?', confirmLabel: 'Reset', message: `Discard every edit to “${scenario.name}” and restore the inputs it started with.` }, () => dispatch({ type: 'scenario/reset', id: scenario.id }))}><RotateCcw size={15} aria-hidden="true" />Reset scenario</button>
            <label className="checkbox"><input type="checkbox" checked={state.settings.autoRecalc} onChange={(e) => dispatch({ type: 'settings/update', settings: { autoRecalc: e.target.checked } })} />Auto-recalculate after edits</label>
          </div>
          {stale && <Banner tone="warning">Inputs changed since the last run. Press <strong>Recalculate</strong> (or Run) to schedule the current inputs.</Banner>}
          <p className="muted" style={{ margin: 0 }}>
            The scheduler computes the whole plan instantly; the clock below only replays it. <strong>Run</strong> recalculates and replays from the first release, <strong>Recalculate</strong> recomputes without touching the clock, <strong>Reset scenario</strong> restores the inputs the scenario started with.
          </p>
          <div className="row" style={{ gap: 12 }}>
            <button className="btn icon" aria-label="Step back one hour" onClick={() => { setPlaying(false); setClock((c) => Math.max(startHour, c - 1)); }}><StepBack size={16} /></button>
            <input type="range" min={startHour} max={endHour} value={clock} onChange={(e) => { setPlaying(false); setClock(Number(e.target.value)); }} aria-label="Simulation clock" style={{ flex: 1, minWidth: 180 }} />
            <button className="btn icon" aria-label="Step forward one hour" onClick={() => { setPlaying(false); setClock((c) => Math.min(endHour, c + 1)); }}><StepForward size={16} /></button>
            <strong className="num" aria-live="off">Hour {clock}</strong><span className="muted">{dayLabel(clock)}</span>
            <label className="row" style={{ gap: 6 }}>Speed
              <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} aria-label="Playback speed" style={{ width: 'auto' }}>
                {[1, 2, 4, 8, 16].map((s) => <option key={s} value={s}>{s} h/s</option>)}
              </select>
            </label>
          </div>
          <div className="legend" aria-label="Fleet state at the current hour">
            <span>Not yet released: <strong>{snap.counts.notReleased}</strong></span>
            <span>Waiting at a terminal: <strong>{snap.counts.waiting}</strong></span>
            <span>In transit: <strong>{snap.counts.inTransit}</strong></span>
            <span>Delivered: <strong>{snap.counts.delivered}</strong></span>
            <span>Undeliverable: <strong>{snap.counts.undeliverable}</strong></span>
            <span className="faint">(of {total})</span>
          </div>
        </div>
      </Card>

      <Card title="Network at the current hour" actions={<span className="muted">dots = shipments in transit · orange badge = shipments waiting at a terminal</span>}>
        <NetworkMap terminals={input.terminals} connections={input.connections} disruptions={input.disruptions} metrics={result.metrics} movements={snap.movements} waiting={snap.waiting} label="Network playback" />
      </Card>

      <Card title="Schedule timeline" actions={<TimelineLegend mode="connection" />}>
        <TimelineChart shipments={result.shipments} connections={input.connections} disruptions={input.disruptions} mode="connection" px={8} clock={clock} />
      </Card>

      <ExpectationsPanel scenario={scenario} run={run} stale={stale} />
      <VerificationPanel run={run} />
      <ScheduleInspector run={run} refRun={ref?.run} refName={ref?.name} scenarioName={scenario.name} />
      {dialog}
    </div>
  );
}
