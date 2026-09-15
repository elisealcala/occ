import type { ExperimentConfig, ExperimentView, Mutation, MutationResult } from './contracts';
export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message); }
}
async function readResponse<T>(response: Response): Promise<T> {
  const body = await response.json();
  if (!response.ok && !(response.status === 409 && body.reason === 'conflict')) throw new ApiError(body.error ?? 'Request failed', response.status);
  return body as T;
}
export const api = {
  create: async (config: ExperimentConfig) => readResponse<ExperimentView>(await fetch('/api/experiments', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(config) })),
  read: async (id: string) => readResponse<ExperimentView>(await fetch(`/api/experiments/${id}`, { cache: 'no-store' })),
  mutate: async (id: string, mutation: Mutation) => readResponse<MutationResult>(await fetch(`/api/experiments/${id}/mutations`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(mutation) })),
};
export type Transport = Pick<typeof api, 'read' | 'mutate'>;
