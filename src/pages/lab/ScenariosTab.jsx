import { useMemo, useState } from 'react';
import { CircleDot, Copy, FilePlus2, Pencil, RotateCcw, Sparkles, Trash2 } from 'lucide-react';
import { useApp } from '../../state/AppState.jsx';
import { listScenarios, isStale } from '../../state/reducer.js';
import { BASELINE_ID, getBaseline } from '../../state/scenarioModel.js';
import { generatedScenarioBody, listPresets } from '../../data/presets.js';
import { DEFAULT_SEED } from '../../data/generator.js';
import DataTable from '../../components/DataTable.jsx';
import { Card, Field, Modal, useConfirm } from '../../components/ui.jsx';
import { SOURCE_LABEL } from '../../utils/format.js';

function RenameModal({ scenario, onClose, onSave }) {
  const [name, setName] = useState(scenario.name);
  const [description, setDescription] = useState(scenario.description ?? '');
  return (
    <Modal title="Rename scenario" onClose={onClose}>
      <form className="stack" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onSave(name, description); }}>
        <Field label="Name"><input type="text" value={name} maxLength={60} onChange={(e) => setName(e.target.value)} autoFocus /></Field>
        <Field label="Description"><textarea rows={3} value={description} maxLength={500} onChange={(e) => setDescription(e.target.value)} style={{ fontFamily: 'inherit' }} /></Field>
        <div className="row end"><button type="button" className="btn" onClick={onClose}>Cancel</button><button className="btn primary" type="submit" disabled={!name.trim()}>Save</button></div>
      </form>
    </Modal>
  );
}

export default function ScenariosTab() {
  const { state, dispatch, scenario } = useApp();
  const [confirm, dialog] = useConfirm();
  const presets = useMemo(() => listPresets(getBaseline()), []);
  const [presetKey, setPresetKey] = useState(presets[0].key);
  const [seed, setSeed] = useState('1');
  const [count, setCount] = useState('100');
  const [forkName, setForkName] = useState('');
  const [renaming, setRenaming] = useState(null);
  const [seedError, setSeedError] = useState('');
  const preset = presets.find((p) => p.key === presetKey);
  const all = listScenarios(state);
  const nameOf = (id) => all.find((s) => s.id === id)?.name ?? '—';

  const columns = [
    { key: 'name', header: 'Scenario', render: (s) => <span className="row" style={{ gap: 6 }}><strong>{s.name}</strong>{s.id === state.activeId && <span className="badge info"><CircleDot size={11} aria-hidden="true" />active</span>}{s.locked && <span className="badge">read-only</span>}</span> },
    { key: 'source', header: 'Origin', render: (s) => SOURCE_LABEL[s.source] ?? s.source },
    { key: 'parent', header: 'Based on', sortValue: (s) => (s.parentId ? nameOf(s.parentId) : ''), render: (s) => (s.parentId ? nameOf(s.parentId) : '—') },
    { key: 'shipments', header: 'Shipments', align: 'r', sortValue: (s) => s.shipments.length, render: (s) => s.shipments.length },
    { key: 'connections', header: 'Connections', align: 'r', sortValue: (s) => s.network.connections.length, render: (s) => s.network.connections.length },
    { key: 'disruptions', header: 'Disruptions', align: 'r', sortValue: (s) => s.disruptions.length, render: (s) => s.disruptions.length },
    { key: 'state', header: 'Results', sortable: false, render: (s) => (isStale(state, s.id) ? <span className="badge warning">stale</span> : <span className="badge good">current</span>) },
    {
      key: 'actions', header: '', sortable: false,
      render: (s) => (
        <span className="row" style={{ gap: 4, flexWrap: 'nowrap' }}>
          <button className="btn sm" disabled={s.id === state.activeId} onClick={() => dispatch({ type: 'scenario/select', id: s.id })} aria-label={`Open ${s.name}`}>Open</button>
          <button className="btn sm" onClick={() => dispatch({ type: 'scenario/fork', sourceId: s.id })} aria-label={`Fork ${s.name}`}><Copy size={13} aria-hidden="true" />Fork</button>
          {!s.locked && <button className="btn sm" onClick={() => setRenaming(s)} aria-label={`Rename ${s.name}`}><Pencil size={13} aria-hidden="true" />Rename</button>}
          {!s.locked && (
            <button className="btn sm danger" aria-label={`Delete ${s.name}`}
              onClick={() => confirm({ title: `Delete “${s.name}”?`, message: 'The scenario and its schedule are removed. The baseline is not affected.' }, () => dispatch({ type: 'scenario/delete', id: s.id }))}><Trash2 size={13} aria-hidden="true" />Delete</button>
          )}
        </span>
      ),
    },
  ];

  const createFromSeed = (e) => {
    e.preventDefault();
    const sd = Number(seed);
    const n = Number(count);
    if (!Number.isInteger(sd) || sd < 0 || sd > 2147483647) return setSeedError('Seed must be a whole number between 0 and 2,147,483,647.');
    if (!Number.isInteger(n) || n < 0 || n > 300) return setSeedError('Shipment count must be a whole number between 0 and 300.');
    setSeedError('');
    dispatch({ type: 'scenario/create', name: `Generated (seed ${sd})`, description: `8 terminals, 15 connections and ${n} shipments generated from seed ${sd}. The same seed always yields the same data.`, source: 'generated', body: generatedScenarioBody(sd, n) });
  };

  return (
    <div className="stack" style={{ gap: 16 }}>
      <Card title="Scenarios" actions={<span className="muted">The baseline is immutable; everything else is yours to edit.</span>} flush>
        <DataTable columns={columns} rows={all} dense caption="Scenarios" />
      </Card>

      <div className="grid equal">
        <Card title="Load a preset test scenario">
          <div className="stack">
            <Field label="Preset">
              <select value={presetKey} onChange={(e) => setPresetKey(e.target.value)} aria-label="Preset scenario">
                {presets.map((p) => <option key={p.key} value={p.key}>{p.name}</option>)}
              </select>
            </Field>
            <p className="muted" style={{ margin: 0 }}>{preset.description}</p>
            {preset.expected?.notes && <p className="muted" style={{ margin: 0 }}><strong>Expected:</strong> {preset.expected.notes}</p>}
            <div><button className="btn primary" onClick={() => dispatch({ type: 'scenario/create', name: preset.name, description: preset.description, source: 'preset', parentId: preset.key === 'disrupted-baseline' ? BASELINE_ID : null, body: { network: preset.network, shipments: preset.shipments, disruptions: preset.disruptions }, expected: preset.expected })}><FilePlus2 size={15} aria-hidden="true" />Create scenario from preset</button></div>
          </div>
        </Card>

        <Card title="Generate from a seed">
          <form className="stack" onSubmit={createFromSeed}>
            <div className="form-grid">
              <Field label="Seed"><input type="number" value={seed} onChange={(e) => setSeed(e.target.value)} min={0} /></Field>
              <Field label="Shipments (0–300)"><input type="number" value={count} onChange={(e) => setCount(e.target.value)} min={0} max={300} /></Field>
            </div>
            <p className="muted" style={{ margin: 0 }}>Uses the same deterministic generator as the baseline (seed {DEFAULT_SEED}, 100 shipments): the same seed always produces the identical network and shipments.</p>
            {seedError && <p className="fail" role="alert" style={{ margin: 0 }}>{seedError}</p>}
            <div><button className="btn primary" type="submit"><Sparkles size={15} aria-hidden="true" />Generate scenario</button></div>
          </form>
        </Card>

        <Card title="Fork the active scenario">
          <form className="stack" onSubmit={(e) => { e.preventDefault(); dispatch({ type: 'scenario/fork', sourceId: scenario.id, name: forkName.trim() || undefined }); setForkName(''); }}>
            <p className="muted" style={{ margin: 0 }}>Make an independent copy of <strong>{scenario.name}</strong>. Edits and recalculations in the copy never touch the original.</p>
            <Field label="Name of the copy (optional)"><input type="text" value={forkName} maxLength={60} onChange={(e) => setForkName(e.target.value)} placeholder={`${scenario.name} (fork)`} /></Field>
            <div><button className="btn primary" type="submit"><Copy size={15} aria-hidden="true" />Fork scenario</button></div>
          </form>
          {!scenario.locked && (
            <div style={{ marginTop: 12 }}>
              <button className="btn" onClick={() => confirm({ title: 'Reset scenario?', confirmLabel: 'Reset', message: `Discard every edit to “${scenario.name}” and restore the inputs it started with.` }, () => dispatch({ type: 'scenario/reset', id: scenario.id }))}><RotateCcw size={15} aria-hidden="true" />Reset active scenario to its starting inputs</button>
            </div>
          )}
        </Card>
      </div>
      {renaming && <RenameModal scenario={renaming} onClose={() => setRenaming(null)} onSave={(name, description) => { dispatch({ type: 'scenario/rename', id: renaming.id, name, description }); setRenaming(null); }} />}
      {dialog}
    </div>
  );
}
