import { createContext, useContext, useEffect, useMemo, useReducer, useRef } from 'react';
import { verifySchedule } from '../engine/verify.js';
import { createInitialState, getScenario, isStale, reducer } from './reducer.js';
import { BASELINE_ID, getBaseline } from './scenarioModel.js';
import { loadState, saveState } from './persistence.js';

const AppContext = createContext(null);

function defaultStorage() {
  try {
    return window.localStorage;
  } catch {
    // Blocked storage: loadState/saveState treat a throwing object as "unavailable".
    return { getItem() { throw new Error('unavailable'); }, setItem() { throw new Error('unavailable'); }, removeItem() { throw new Error('unavailable'); } };
  }
}

function init(storage) {
  const { persisted, notices } = loadState(storage);
  return createInitialState(persisted, notices);
}

export function AppStateProvider({ children, storage }) {
  const store = useMemo(() => storage ?? defaultStorage(), [storage]);
  const [state, dispatch] = useReducer(reducer, store, init);
  const warnedRef = useRef(false);

  // Persist user-owned state whenever it changes (runs and notices are derived/transient).
  useEffect(() => {
    const res = saveState(state, store);
    if (!res.ok && !warnedRef.current) {
      warnedRef.current = true;
      dispatch({ type: 'notice/push', level: 'warning', text: `Changes could not be saved: ${res.error}. They will be lost on reload.` });
    }
    if (res.ok) warnedRef.current = false;
  }, [state.scenarios, state.activeId, state.settings, state.nextScenarioNumber, store]);

  const value = useMemo(() => {
    const scenario = getScenario(state, state.activeId) ?? getBaseline();
    const run = state.runs[scenario.id] ?? null;
    return {
      state,
      dispatch,
      scenario,
      run,
      input: run?.input ?? null,
      result: run?.result ?? null,
      stale: isStale(state, scenario.id),
      baseline: getBaseline(),
      baselineResult: state.runs[BASELINE_ID].result,
    };
  }, [state]);

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>;
}

export function useApp() {
  const ctx = useContext(AppContext);
  if (!ctx) throw new Error('useApp must be used inside AppStateProvider');
  return ctx;
}

/** Independent verification of a run's schedule against the input it was computed from (memoised per run). */
export function useVerification(run) {
  return useMemo(() => (run ? verifySchedule(run.input, run.result) : null), [run]);
}

/**
 * The run an impact report should compare the active scenario against: its parent if that still
 * exists, otherwise the baseline. Null when the active scenario is the baseline itself.
 */
export function useReference() {
  const { state, scenario } = useApp();
  return useMemo(() => {
    if (scenario.id === BASELINE_ID) return null;
    const parent = scenario.parentId ? getScenario(state, scenario.parentId) : null;
    const ref = parent && state.runs[parent.id] ? parent : getBaseline();
    return { id: ref.id, name: ref.name, run: state.runs[ref.id] };
  }, [state, scenario]);
}
