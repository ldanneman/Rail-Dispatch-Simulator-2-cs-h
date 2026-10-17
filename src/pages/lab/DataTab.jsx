import { useMemo, useRef, useState } from 'react';
import { ClipboardCopy, Download, FileDown, FileUp, RotateCcw } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { documentToJson, exportFileName, scenarioToDocument, scheduleToCsv } from '../../data/serialization.js';
import { parseScenarioText } from '../../data/validation.js';
import { Banner, Card, useConfirm } from '../../components/ui.jsx';
import { downloadText, readFileText } from '../../utils/download.js';

const SECTION_LABEL = { network: 'Network (terminals + connections)', shipments: 'Shipments', disruptions: 'Disruption settings', expected: 'Expected results' };

function ImportCard() {
  const { scenario, dispatch } = useApp();
  const fileRef = useRef(null);
  const [text, setText] = useState('');
  const [fileName, setFileName] = useState('');
  const [mode, setMode] = useState('new');
  const [picked, setPicked] = useState({ network: true, shipments: true, disruptions: true, expected: true });

  const parsed = useMemo(() => (text.trim() ? parseScenarioText(text, { requireNetwork: mode === 'new' }) : null), [text, mode]);

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try {
      setText(await readFileText(file));
      setFileName(file.name);
    } catch {
      setText('');
      dispatch({ type: 'notice/push', level: 'error', text: `Could not read ${file.name}.` });
    }
    e.target.value = '';
  };

  const doImport = () => {
    const v = parsed.value;
    if (mode === 'new') {
      const name = v.name ?? (fileName.replace(/\.json$/i, '') || 'Imported scenario');
      dispatch({ type: 'scenario/create', name, description: v.description ?? `Imported from ${fileName || 'pasted JSON'}.`, source: 'import', body: { network: v.network, shipments: v.shipments ?? [], disruptions: v.disruptions ?? [] }, expected: v.expected ?? null });
    } else {
      const body = {};
      for (const k of ['network', 'shipments', 'disruptions', 'expected']) if (parsed.sections[k] && picked[k]) body[k] = v[k];
      dispatch({ type: 'scenario/applySections', id: scenario.id, body });
    }
    setText('');
    setFileName('');
  };

  const available = parsed ? Object.keys(SECTION_LABEL).filter((k) => parsed.sections[k]) : [];
  const nothingPicked = mode === 'apply' && !available.some((k) => picked[k]);

  return (
    <Card title="Import JSON">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Import a complete scenario, or just a network, shipment list or disruption settings, using the documented schema below. Everything is validated before anything is accepted.</p>
        <div className="row">
          <input ref={fileRef} type="file" accept=".json,application/json" onChange={onFile} className="sr-only" aria-label="Scenario file" id="import-file" />
          <button className="btn" onClick={() => fileRef.current?.click()}><FileUp size={15} aria-hidden="true" />Choose file…</button>
          {fileName && <span className="muted">{fileName}</span>}
        </div>
        <textarea rows={7} value={text} onChange={(e) => { setText(e.target.value); setFileName(''); }} placeholder="…or paste scenario JSON here" aria-label="Scenario JSON" spellCheck={false} />
        <div className="row">
          <label className="checkbox"><input type="radio" name="import-mode" checked={mode === 'new'} onChange={() => setMode('new')} />Create a new scenario</label>
          <label className="checkbox"><input type="radio" name="import-mode" checked={mode === 'apply'} onChange={() => setMode('apply')} disabled={scenario.locked} />Replace sections of the active scenario{scenario.locked ? ' (baseline is read-only)' : ` (“${scenario.name}”)`}</label>
        </div>

        {parsed && !parsed.ok && (
          <Banner tone="error">
            <strong>Import rejected — {parsed.errors.length} problem{parsed.errors.length === 1 ? '' : 's'}.</strong> Nothing was changed.
            <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
              {parsed.errors.slice(0, 12).map((e, i) => <li key={i}><code>{e.path}</code> {e.message}</li>)}
              {parsed.errors.length > 12 && <li>…and {parsed.errors.length - 12} more</li>}
            </ul>
          </Banner>
        )}
        {parsed?.ok && (
          <>
            <Banner tone="ok">
              Valid. Contains: {available.map((k) => SECTION_LABEL[k]).join(', ') || 'nothing importable'}.
              {parsed.value.network && ` ${parsed.value.network.terminals.length} terminals, ${parsed.value.network.connections.length} connections.`}
              {parsed.value.shipments && ` ${parsed.value.shipments.length} shipments.`}
              {parsed.value.disruptions && ` ${parsed.value.disruptions.length} disruptions.`}
            </Banner>
            {parsed.warnings.length > 0 && (
              <Banner tone="warning">
                {parsed.warnings.length} warning{parsed.warnings.length === 1 ? '' : 's'}:
                <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>{parsed.warnings.slice(0, 6).map((w, i) => <li key={i}><code>{w.path}</code> {w.message}</li>)}</ul>
              </Banner>
            )}
            {mode === 'apply' && (
              <div className="row">
                {available.map((k) => <label key={k} className="checkbox"><input type="checkbox" checked={picked[k]} onChange={(e) => setPicked((p) => ({ ...p, [k]: e.target.checked }))} />{SECTION_LABEL[k]}</label>)}
              </div>
            )}
            <div><button className="btn primary" onClick={doImport} disabled={nothingPicked}>{mode === 'new' ? 'Import as new scenario' : 'Apply to active scenario'}</button></div>
          </>
        )}
      </div>
    </Card>
  );
}

function ExportCard() {
  const { scenario, result, dispatch } = useApp();
  const json = useMemo(() => documentToJson(scenarioToDocument(scenario)), [scenario]);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      dispatch({ type: 'notice/push', level: 'ok', text: 'Scenario JSON copied to the clipboard.' });
    } catch {
      dispatch({ type: 'notice/push', level: 'warning', text: 'Clipboard access was denied; use Download instead.' });
    }
  };
  return (
    <Card title="Export JSON">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>Exports the active scenario’s inputs (network, shipments, disruptions{scenario.expected ? ', expected results' : ''}) in the schema below. Results are not exported: re-importing the file and running it reproduces them exactly.</p>
        <div className="row">
          <button className="btn primary" onClick={() => downloadText(exportFileName(scenario), json)}><Download size={15} aria-hidden="true" />Download JSON</button>
          <button className="btn" onClick={copy}><ClipboardCopy size={15} aria-hidden="true" />Copy</button>
          <button className="btn" disabled={!result} onClick={() => { downloadText(`schedule-${exportFileName(scenario).replace(/^rail-dispatch-|\.json$/g, '')}.csv`, scheduleToCsv(result), 'text/csv'); }}><FileDown size={15} aria-hidden="true" />Schedule CSV</button>
        </div>
        <details>
          <summary>Preview ({json.length.toLocaleString()} characters)</summary>
          <pre className="code" tabIndex={0}>{json.slice(0, 6000)}{json.length > 6000 ? '\n…' : ''}</pre>
        </details>
      </div>
    </Card>
  );
}

const EXAMPLE = `{
  "schema": "rail-dispatch-scenario",
  "version": 1,
  "name": "Two-hop example",
  "network": {
    "terminals": [
      { "id": "A", "name": "Terminal A", "x": 10, "y": 32 },
      { "id": "B", "name": "Terminal B", "x": 50, "y": 32 },
      { "id": "C", "name": "Terminal C", "x": 90, "y": 32 }
    ],
    "connections": [
      { "id": "AB", "from": "A", "to": "B", "travelTime": 1, "capacity": 1 },
      { "id": "BC", "from": "B", "to": "C", "travelTime": 1, "capacity": 1, "bidirectional": true }
    ]
  },
  "shipments": [
    { "id": "S1", "origin": "A", "destination": "C", "release": 8, "deadline": 14, "priority": 2 }
  ],
  "disruptions": [
    { "id": "D1", "type": "closure", "connectionId": "BC", "startHour": 20, "endHour": 30 }
  ],
  "expected": {
    "shipments": { "S1": { "status": "on_time", "arrival": 10, "route": ["AB", "BC"], "departures": [8, 9] } }
  }
}`;

function SchemaCard() {
  return (
    <Card title="JSON schema (version 1)">
      <div className="stack">
        <p className="muted" style={{ margin: 0 }}>
          Times are integer hours from hour 0; intervals are half-open <code>[start, end)</code>. Only <code>network</code> is required for a new scenario; omitted sections default to empty.
          The machine-readable JSON Schema ships with the project as <code>schema/rail-scenario.schema.json</code>.
        </p>
        <div className="table-wrap">
          <table className="t dense">
            <thead><tr><th>Section</th><th>Fields</th></tr></thead>
            <tbody>
              <tr><td><code>terminals[]</code></td><td><code>id</code>, <code>name?</code>, <code>x?</code>, <code>y?</code> (map position; auto-laid-out when missing)</td></tr>
              <tr><td><code>connections[]</code></td><td><code>id</code>, <code>from</code>, <code>to</code>, <code>travelTime</code> (≥1 h), <code>capacity</code> (≥1 per hourly departure slot), <code>bidirectional?</code> (default true; both directions share capacity)</td></tr>
              <tr><td><code>shipments[]</code></td><td><code>id</code>, <code>origin</code>, <code>destination</code>, <code>release</code>, <code>deadline</code> (≥ release), <code>priority</code> (1 Low … 4 Critical), <code>cargo?</code></td></tr>
              <tr><td><code>disruptions[]</code></td><td><code>closure</code>: <code>connectionId, startHour, endHour</code> · <code>travel_time</code>: + <code>extraHours</code> · <code>capacity</code>: + <code>capacity</code> (≥0) · <code>release_delay</code>: <code>shipmentId, delayHours</code></td></tr>
              <tr><td><code>expected</code></td><td><code>notes?</code>, <code>shipments</code>: id → <code>status?, arrival?, route?, departures?</code> — checked against the engine in the Simulation tab</td></tr>
            </tbody>
          </table>
        </div>
        <details>
          <summary>Example document</summary>
          <pre className="code" tabIndex={0}>{EXAMPLE}</pre>
        </details>
      </div>
    </Card>
  );
}

export default function DataTab() {
  const { dispatch } = useApp();
  const [confirm, dialog] = useConfirm();
  return (
    <div className="stack" style={{ gap: 16 }}>
      <div className="grid equal"><ImportCard /><ExportCard /></div>
      <SchemaCard />
      <Card title="Reset workspace">
        <div className="row">
          <p className="muted" style={{ margin: 0, flex: 1, minWidth: 240 }}>Delete every custom scenario and restore the original seeded state. Your edits are stored in this browser only (localStorage).</p>
          <button className="btn danger" onClick={() => confirm({ title: 'Reset workspace?', confirmLabel: 'Reset everything', message: 'All custom scenarios, imports and edits will be deleted. The seeded baseline is restored.' }, () => dispatch({ type: 'workspace/reset' }))}><RotateCcw size={15} aria-hidden="true" />Reset to seeded state</button>
        </div>
      </Card>
      {dialog}
    </div>
  );
}
