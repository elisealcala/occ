import { ApiError, api } from './api';
import type { ExperimentConfig, ExperimentView } from './contracts';
import type { ScenarioId } from './scenarios';

const STORAGE_KEY = 'occ-sandbox-experiment';
let initialRequest: Promise<ExperimentView> | undefined;
export function loadInitialExperiment() {
  initialRequest ??= (async () => {
    let id: string | null = null;
    try {
      id = localStorage.getItem(STORAGE_KEY);
    } catch {
      /* Storage is optional. */
    }
    if (id) {
      try {
        return await api.read(id);
      } catch (error) {
        if (!(error instanceof ApiError && error.status === 404)) throw error;
      }
    }
    return api.create({ occEnabled: true, checkpointsEnabled: true });
  })().catch((error) => {
    initialRequest = undefined;
    throw error;
  });
  return initialRequest;
}
export function rememberExperiment(view: ExperimentView) {
  try {
    localStorage.setItem(STORAGE_KEY, view.document.experimentId);
  } catch {
    /* Session still works without storage. */
  }
  initialRequest = Promise.resolve(view);
}
export type SessionSpec = { initial: ExperimentView; scenario?: ScenarioId };

export type ResetExperiment = (config: ExperimentConfig, scenario?: ScenarioId) => Promise<void>;
