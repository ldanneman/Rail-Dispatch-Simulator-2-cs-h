import { NavLink, Navigate, Route, Routes } from 'react-router-dom';
import { GitBranch, Lock } from 'lucide-react';
import { useApp } from '../state/AppState.jsx';
import { BASELINE_ID } from '../state/scenarioModel.js';
import { Banner } from '../components/ui.jsx';
import ScenariosTab from './lab/ScenariosTab.jsx';
import NetworkEditor from './lab/NetworkEditor.jsx';
import ShipmentEditor from './lab/ShipmentEditor.jsx';
import SimulationTab from './lab/SimulationTab.jsx';
import CapacityTab from './lab/CapacityTab.jsx';
import DataTab from './lab/DataTab.jsx';

const TABS = [
  ['scenarios', 'Scenarios'],
  ['network', 'Network editor'],
  ['shipments', 'Shipment editor'],
  ['simulation', 'Simulation & schedule'],
  ['capacity', 'Capacity inspection'],
  ['data', 'Import / export'],
];

export default function TestLabPage() {
  const { scenario, dispatch } = useApp();
  return (
    <main className="page">
      <div className="page-head">
        <div>
          <h1>Test Lab</h1>
          <p>Build, modify and run your own simulations. Editing <strong>{scenario.name}</strong>; every number you see is produced by the scheduling engine from these inputs.</p>
        </div>
      </div>
      {scenario.locked && (
        <Banner tone="info" actions={<button className="btn primary" onClick={() => dispatch({ type: 'scenario/fork', sourceId: BASELINE_ID, name: 'My experiment' })}><GitBranch size={15} aria-hidden="true" />Fork baseline to edit</button>}>
          <Lock size={13} style={{ verticalAlign: -2 }} aria-hidden="true" /> The baseline is immutable, so the editors are read-only here. Fork it (or load a preset) to start experimenting.
        </Banner>
      )}
      <nav className="tabs" aria-label="Test Lab sections">
        {TABS.map(([path, label]) => <NavLink key={path} to={`/lab/${path}`}>{label}</NavLink>)}
      </nav>
      <div key={scenario.id}>
        <Routes>
          <Route index element={<Navigate to="scenarios" replace />} />
          <Route path="scenarios" element={<ScenariosTab />} />
          <Route path="network" element={<NetworkEditor />} />
          <Route path="shipments" element={<ShipmentEditor />} />
          <Route path="simulation" element={<SimulationTab />} />
          <Route path="capacity" element={<CapacityTab />} />
          <Route path="data" element={<DataTab />} />
          <Route path="*" element={<Navigate to="scenarios" replace />} />
        </Routes>
      </div>
    </main>
  );
}
