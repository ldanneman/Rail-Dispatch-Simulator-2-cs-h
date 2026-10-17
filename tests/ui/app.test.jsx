import { cleanup, render, screen, within, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it } from 'vitest';
import App from '../../src/App.jsx';
import { runSchedule } from '../../src/engine/index.js';
import { engineInput, getBaseline } from '../../src/state/scenarioModel.js';
import { STORAGE_KEY } from '../../src/state/persistence.js';

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return { getItem: (k) => (map.has(k) ? map.get(k) : null), setItem: (k, v) => void map.set(k, String(v)), removeItem: (k) => void map.delete(k), map };
}
const mount = (storage, path = '/') => render(<App storage={storage} Router={MemoryRouter} routerProps={{ initialEntries: [path] }} />);
const activeScenario = () => screen.getByLabelText('Active scenario');
const baseline = getBaseline();
const baselineResult = runSchedule(engineInput(baseline));

afterEach(cleanup);

describe('dashboard', () => {
  it('shows metrics derived from the engine, not constants', () => {
    mount(memoryStorage());
    const m = baselineResult.metrics;
    const card = screen.getByText('On-time delivery').closest('.kpi');
    expect(within(card).getByText(`${Math.round(m.onTimePct * 10) / 10}%`)).toBeInTheDocument();
    expect(within(card).getByText(`${m.totals.onTime} of ${m.totals.shipments} shipments`)).toBeInTheDocument();
    const undCard = screen.getAllByText('Undeliverable').map((e) => e.closest('.kpi')).find(Boolean);
    expect(within(undCard).getByText(String(m.totals.undeliverable))).toBeInTheDocument();
    expect(screen.getByText('Schedule verified')).toBeInTheDocument();
    expect(screen.getByText('Immutable baseline')).toBeInTheDocument();
  });
});

describe('shipments table', () => {
  it('searches, filters and sorts', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/shipments');
    expect(screen.getByText('Showing 100 of 100')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'undeliverable');
    const und = baselineResult.metrics.totals.undeliverable;
    expect(screen.getByText(`Showing ${und} of 100`)).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Filter by status'), 'all');
    await user.type(screen.getByLabelText('Search shipments'), 'S001');
    expect(screen.getByText('Showing 1 of 100')).toBeInTheDocument();
    await user.clear(screen.getByLabelText('Search shipments'));
    await user.click(screen.getByRole('button', { name: 'Priority' }));
    const firstRow = screen.getAllByRole('row')[1];
    expect(within(firstRow).getByText('Low')).toBeInTheDocument(); // ascending by priority value
    await user.click(screen.getByRole('button', { name: 'Priority' }));
    expect(within(screen.getAllByRole('row')[1]).getByText('Critical')).toBeInTheDocument();
  });

  it('opens the route and per-leg schedule of a shipment', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/shipments');
    await user.type(screen.getByLabelText('Search shipments'), 'S001');
    await user.click(screen.getByText('S001'));
    const dialog = screen.getByRole('dialog');
    const s = baselineResult.shipments.find((x) => x.id === 'S001');
    expect(within(dialog).getByText('Scheduled movements')).toBeInTheDocument();
    expect(within(dialog).getAllByRole('row').length).toBe(1 + s.legs.length);
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});

describe('test lab', () => {
  it('is read-only on the baseline and offers a fork', async () => {
    mount(memoryStorage(), '/lab/shipments');
    expect(screen.getByRole('button', { name: 'Add shipment' })).toBeDisabled();
    expect(screen.getByRole('button', { name: /Fork baseline to edit/ })).toBeInTheDocument();
  });

  it('persists forks, edits and imports across a reload (unmount + remount on the same storage)', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    mount(storage, '/lab/scenarios');
    await user.click(screen.getByRole('button', { name: 'Fork scenario' }));
    expect(activeScenario()).toHaveValue('sc-1');

    // add a shipment through the form
    await user.click(screen.getByRole('link', { name: 'Shipment editor' }));
    await user.clear(screen.getByLabelText('Release (hour)'));
    await user.type(screen.getByLabelText('Release (hour)'), '12');
    await user.clear(screen.getByLabelText('Deadline (hour)'));
    await user.type(screen.getByLabelText('Deadline (hour)'), '30');
    await user.selectOptions(screen.getByLabelText('Origin', { selector: 'select' }), 'T1');
    await user.selectOptions(screen.getByLabelText('Destination', { selector: 'select' }), 'T7');
    await user.click(screen.getByRole('button', { name: 'Add shipment' }));
    await user.type(screen.getByLabelText('Search shipments to edit'), 'S101');
    expect(screen.getByRole('row', { name: /S101/ })).toBeInTheDocument();
    expect(storage.map.has(STORAGE_KEY)).toBe(true);

    // add a disruption on the Disruptions page
    cleanup();
    mount(storage, '/disruptions'); // "reload" #1
    expect(activeScenario()).toHaveValue('sc-1');
    await user.click(screen.getByRole('button', { name: 'Add disruption' }));
    expect(screen.getByText('Active disruptions (1)')).toBeInTheDocument();

    // reload #2: everything is still there, and the schedule is recomputed
    cleanup();
    mount(storage, '/lab/shipments');
    expect(activeScenario()).toHaveValue('sc-1');
    await user.type(screen.getByLabelText('Search shipments to edit'), 'S101');
    expect(screen.getByRole('row', { name: /S101/ })).toBeInTheDocument();
    expect(screen.getByText('Shipments (1 of 101)')).toBeInTheDocument();
    // and the baseline is untouched
    await user.selectOptions(activeScenario(), 'baseline');
    await user.clear(screen.getByLabelText('Search shipments to edit'));
    await user.type(screen.getByLabelText('Search shipments to edit'), 'S101');
    expect(screen.queryByRole('row', { name: /S101/ })).not.toBeInTheDocument();
  });

  it('rejects malformed imports without changing anything, and imports a valid file', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    mount(storage, '/lab/data');
    const box = screen.getByRole('textbox', { name: 'Scenario JSON' });
    await user.click(box);
    await user.paste('{"network": {"terminals": [{"id": "A"}], "connections": [{"id": "X", "from": "A", "to": "Z", "travelTime": 0, "capacity": 1}]}}');
    expect(screen.getByText(/Import rejected/)).toBeInTheDocument();
    expect(screen.getByText(/unknown terminal "Z"/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Import as new scenario' })).not.toBeInTheDocument();
    expect(Array.from(activeScenario().options).map((o) => o.value)).toEqual(['baseline']);

    await user.clear(box);
    await user.click(box);
    await user.paste('not json at all');
    expect(screen.getByText(/not valid JSON/)).toBeInTheDocument();

    await user.clear(box);
    await user.click(box);
    await user.paste(JSON.stringify({ name: 'Mini', network: { terminals: [{ id: 'A' }, { id: 'B' }], connections: [{ id: 'AB', from: 'A', to: 'B', travelTime: 2, capacity: 1 }] }, shipments: [{ id: 'Q1', origin: 'A', destination: 'B', release: 1, deadline: 5, priority: 2 }] }));
    await user.click(screen.getByRole('button', { name: 'Import as new scenario' }));
    expect(activeScenario().selectedOptions[0].textContent).toBe('Mini');
    const saved = JSON.parse(storage.getItem(STORAGE_KEY));
    expect(saved.scenarios[0].shipments[0].id).toBe('Q1');
  });

  it('the three-terminal preset shows arrivals 10, 11, 12 and all expectations passing', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/lab/scenarios');
    await user.selectOptions(screen.getByLabelText('Preset scenario'), 'reference-three-terminal');
    await user.click(screen.getByRole('button', { name: 'Create scenario from preset' }));
    await user.click(screen.getByRole('link', { name: 'Simulation & schedule' }));
    expect(screen.getByText(/All 12 checks match/)).toBeInTheDocument();
    const list = screen.getByRole('table', { name: 'Shipments' });
    for (const [id, h] of [['S1', 'h10'], ['S2', 'h11'], ['S3', 'h12']]) {
      expect(within(within(list).getByText(id).closest('tr')).getByText(h)).toBeInTheDocument();
    }
  });

  it('shows validation errors for impossible edits and keeps the data unchanged', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/lab/scenarios');
    await user.click(screen.getByRole('button', { name: 'Fork scenario' }));
    await user.click(screen.getByRole('link', { name: 'Shipment editor' }));
    await user.selectOptions(screen.getByLabelText('Destination', { selector: 'select' }), 'T1');
    await user.click(screen.getByRole('button', { name: 'Add shipment' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/origin and destination must differ/);
    expect(screen.getByText(/Shipments \(100\)/)).toBeInTheDocument();
  });

  it('confirms before deleting a terminal and cascades the dependent records', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/lab/scenarios');
    await user.click(screen.getByRole('button', { name: 'Fork scenario' }));
    await user.click(screen.getByRole('link', { name: 'Network editor' }));
    await user.click(screen.getByRole('button', { name: 'Delete terminal T1' }));
    const dialog = screen.getByRole('dialog');
    expect(dialog).toHaveTextContent(/also removes 3 connections/);
    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Terminals (7)')).toBeInTheDocument();
    expect(screen.getByText('Connections (12)')).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText('Schedule verified')).toBeInTheDocument());
  });
});

describe('disruptions page', () => {
  it('adds a closure, shows the impact against the baseline and keeps the baseline result', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/disruptions');
    expect(screen.getByRole('button', { name: 'Add disruption' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Create what-if scenario' }));
    await user.selectOptions(screen.getByLabelText('Connection', { exact: true }), 'C03');
    await user.clear(screen.getByLabelText('Until hour (excl.)'));
    await user.type(screen.getByLabelText('Until hour (excl.)'), '60');
    await user.click(screen.getByRole('button', { name: 'Add disruption' }));
    expect(screen.getByText('closure of C03 [0, 60)')).toBeInTheDocument();
    expect(screen.getByText(/Affected \d+/)).toBeInTheDocument();
    const impact = screen.getByText('On-time delivery').closest('tr');
    expect(within(impact).getByText(/85%/)).toBeInTheDocument(); // baseline column
    await user.selectOptions(activeScenario(), 'baseline');
    expect(screen.getByRole('button', { name: 'Add disruption' })).toBeDisabled();
  });

  it('rejects a closure whose end precedes its start', async () => {
    const user = userEvent.setup();
    mount(memoryStorage(), '/disruptions');
    await user.click(screen.getByRole('button', { name: 'Create what-if scenario' }));
    await user.clear(screen.getByLabelText('From hour (incl.)'));
    await user.type(screen.getByLabelText('From hour (incl.)'), '30');
    await user.clear(screen.getByLabelText('Until hour (excl.)'));
    await user.type(screen.getByLabelText('Until hour (excl.)'), '10');
    await user.click(screen.getByRole('button', { name: 'Add disruption' }));
    expect(screen.getByRole('alert')).toHaveTextContent(/must be greater than startHour/);
    expect(screen.getByText('Active disruptions (0)')).toBeInTheDocument();
  });
});

describe('resilience', () => {
  it('starts cleanly from corrupted storage and tells the user', () => {
    mount(memoryStorage({ [STORAGE_KEY]: '{definitely not json' }));
    expect(screen.getByText(/Saved data was corrupted/)).toBeInTheDocument();
    expect(screen.getByText('Immutable baseline')).toBeInTheDocument();
  });

  it('keeps working when storage is blocked', () => {
    const blocked = { getItem() { throw new Error('denied'); }, setItem() { throw new Error('denied'); }, removeItem() {} };
    mount(blocked);
    expect(screen.getByText(/Browser storage is unavailable/)).toBeInTheDocument();
    expect(screen.getByText('Schedule verified')).toBeInTheDocument();
  });

  it('resets the whole workspace to the seeded state', async () => {
    const user = userEvent.setup();
    const storage = memoryStorage();
    mount(storage, '/lab/scenarios');
    await user.click(screen.getByRole('button', { name: 'Fork scenario' }));
    await user.click(screen.getByRole('link', { name: 'Import / export' }));
    await user.click(screen.getByRole('button', { name: 'Reset to seeded state' }));
    await user.click(screen.getByRole('button', { name: 'Reset everything' }));
    expect(Array.from(activeScenario().options).map((o) => o.value)).toEqual(['baseline']);
    expect(JSON.parse(storage.getItem(STORAGE_KEY)).scenarios).toEqual([]);
  });
});
