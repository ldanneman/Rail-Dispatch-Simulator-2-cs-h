import { HORIZON_HOURS, MAX_REFINEMENT_PASSES } from '../engine/constants.js';
import { DEFAULT_SEED } from '../data/generator.js';
import { getBaseline } from '../state/scenarioModel.js';

export default function AssumptionsPage() {
  return (
    <main className="page">
      <div className="page-head"><div><h1>Assumptions & formulas</h1><p>The exact rules the scheduling engine and the dashboard apply. They are applied identically by the scheduler, the disruption logic, the independent verifier and the automated tests.</p></div></div>
      <article className="card card-body prose">
        <h2>Time</h2>
        <ul>
          <li>Discrete simulation with one-hour slots. Times are integer hours from a common start (hour 0 = Day 1, 00:00).</li>
          <li>Every interval is half-open, <code>[start, end)</code>. A movement departing at hour <em>d</em> with travel time <em>t</em> occupies <code>[d, d+t)</code> and arrives at <code>d+t</code>.</li>
          <li>The planning horizon is {HORIZON_HOURS} hours (seven days): departures must be in slots 0…{HORIZON_HOURS - 1} and arrivals must be at or before hour {HORIZON_HOURS}.</li>
        </ul>

        <h2>Capacity</h2>
        <ul>
          <li><strong>Capacity is the maximum number of movements <em>entering</em> a connection during one hourly departure slot</strong>, regardless of how long the traversal takes. A 10-hour connection with capacity 2 accepts two new movements every hour even though many are on it at once.</li>
          <li>A bidirectional connection (the default) shares one capacity between both directions. Model each direction as its own one-way connection for separate capacity.</li>
          <li>Terminals have no handling capacity: shipments may wait at a terminal for any length of time, and terminal figures are <strong>throughput</strong> (arrivals and departures), not percentages.</li>
        </ul>

        <h2>Disruptions</h2>
        <ul>
          <li><strong>Closure</strong> <code>[s, e)</code>: a movement may not depart at <em>d</em> if its traversal interval overlaps the closure, i.e. <code>d &lt; e and s &lt; d + travel time</code>. Arriving exactly at <em>s</em> or departing exactly at <em>e</em> is allowed.</li>
          <li><strong>Travel-time increase</strong>: adds hours to movements <em>departing</em> in <code>[s, e)</code>. Overlapping increases add up. Closure overlap uses the increased travel time.</li>
          <li><strong>Capacity reduction</strong>: movements departing in <code>[s, e)</code> see the lower of the base and reduced capacity (the lowest wins when several overlap). A reduction to 0 blocks all departures.</li>
          <li><strong>Release delay</strong>: adds hours to a shipment’s release; several delays on the same shipment add up.</li>
        </ul>

        <h2>Scheduling algorithm</h2>
        <ul>
          <li>Shipments are scheduled one at a time. Order: <strong>priority</strong> (Critical first), then <strong>least slack</strong> (deadline minus earliest possible arrival), then earlier deadline, earlier effective release, and finally the shipment id (natural order, S2 before S10).</li>
          <li>Each shipment gets its <strong>earliest-arrival route</strong> through the time-expanded network given the capacity already reserved: a Dijkstra search over terminals where each connection’s cost is the best available departure slot (scanning every slot, so a later departure that arrives earlier under a travel-time disruption is found). Waiting at terminals is free, which makes “arrive earlier” always at least as good and the search exact for the current reservations.</li>
          <li>Ties: earliest arrival, then fewer movements, then lower terminal id; for a connection, the earliest departure. The connection list is explored in id order.</li>
          <li>After the first pass, a bounded refinement (at most {MAX_REFINEMENT_PASSES} extra passes) promotes late or unrouted shipments to the front of their priority class and keeps a pass only if it is strictly better on (weighted undeliverable, weighted late, weighted lateness hours). Weights: Low 1, Standard 2, High 4, Critical 8.</li>
          <li>This is a deterministic greedy heuristic with local improvement. It is <strong>not</strong> claimed to be mathematically optimal.</li>
          <li>A shipment is <strong>late</strong> when it arrives after its deadline (arrival ≤ deadline is on time). It is <strong>undeliverable</strong> only when no route or schedule exists within the horizon, and the reason is recorded (disconnected network, transit longer than the horizon, release beyond the horizon, blocked by named disruptions, or capacity exhausted).</li>
        </ul>

        <h2>Metrics</h2>
        <table>
          <thead><tr><th>Metric</th><th>Formula</th></tr></thead>
          <tbody>
            <tr><td>On-time %</td><td>on-time shipments ÷ <em>all</em> shipments × 100. Undeliverable shipments count as not on time.</td></tr>
            <tr><td>Average delivery delay</td><td>sum of lateness ÷ delivered shipments, where lateness = max(0, arrival − deadline); on-time deliveries contribute 0. Undeliverable shipments are excluded and reported separately.</td></tr>
            <tr><td>Avg delay of late shipments</td><td>sum of lateness ÷ late shipments</td></tr>
            <tr><td>Connection utilization</td><td>movements ÷ Σ slot capacity over the <em>operating window</em> (first to last departure slot of the schedule). Closed slots contribute 0 capacity; reduced capacity is honoured.</td></tr>
            <tr><td>7-day utilization</td><td>movements ÷ Σ slot capacity over all {HORIZON_HOURS} slots</td></tr>
            <tr><td>Peak slot load / full slots</td><td>max over slots of used ÷ capacity; number of slots where used = capacity &gt; 0</td></tr>
            <tr><td>Queued hours</td><td>total hours shipments waited before entering the connection (departure − ready time)</td></tr>
            <tr><td>Terminal throughput</td><td>departures and arrivals of scheduled movements; transfers = arrivals − deliveries</td></tr>
            <tr><td>Rerouted shipments</td><td>routed in both scenarios with a different connection sequence</td></tr>
          </tbody>
        </table>

        <h2>Scenarios & data</h2>
        <ul>
          <li>The <strong>baseline</strong> is generated from seed {DEFAULT_SEED} ({getBaseline().network.terminals.length} terminals, {getBaseline().network.connections.length} connections, {getBaseline().shipments.length} shipments), frozen in memory and never persisted or editable. Forks are deep copies.</li>
          <li>Your scenarios are saved in this browser’s localStorage and survive reloads. Schedules are recomputed on load (the engine is deterministic).</li>
          <li>Identical inputs always yield identical schedules, regardless of the order of records.</li>
          <li>The importer validates every field and reference before accepting a file; invalid files change nothing.</li>
        </ul>
      </article>
    </main>
  );
}
