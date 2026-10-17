import { HashRouter, Route, Routes } from 'react-router-dom';
import { AppStateProvider } from './state/AppState.jsx';
import AppLayout from './components/Layout.jsx';
import DashboardPage from './pages/DashboardPage.jsx';
import ShipmentsPage from './pages/ShipmentsPage.jsx';
import TimelinePage from './pages/TimelinePage.jsx';
import DisruptionsPage from './pages/DisruptionsPage.jsx';
import ComparePage from './pages/ComparePage.jsx';
import TestLabPage from './pages/TestLabPage.jsx';
import AssumptionsPage from './pages/AssumptionsPage.jsx';

export default function App({ storage, Router = HashRouter, routerProps }) {
  return (
    <AppStateProvider storage={storage}>
      <Router {...routerProps}>
        <Routes>
          <Route element={<AppLayout />}>
            <Route index element={<DashboardPage />} />
            <Route path="shipments" element={<ShipmentsPage />} />
            <Route path="timeline" element={<TimelinePage />} />
            <Route path="disruptions" element={<DisruptionsPage />} />
            <Route path="compare" element={<ComparePage />} />
            <Route path="lab/*" element={<TestLabPage />} />
            <Route path="about" element={<AssumptionsPage />} />
            <Route path="*" element={<DashboardPage />} />
          </Route>
        </Routes>
      </Router>
    </AppStateProvider>
  );
}
