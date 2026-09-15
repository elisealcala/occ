import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Worker } from 'node:worker_threads';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { SEED_CONTENT, textDocument, type Mutation, type MutationResult } from '../../src/lib/contracts';
import { createRepository, type Repository } from '../../src/server/database';

const config = { occEnabled: true, checkpointsEnabled: true };
function mutation(overrides: Partial<Mutation> = {}): Mutation {
  return {
    clientId: 'A', mutationId: randomUUID(), expectedRevision: 1,
    content: textDocument('A new draft'), checkpoint: false,
    requestDelayMs: 0, responseDelayMs: 0, ...overrides,
  };
}

describe('SQLite experiment repository', () => {
  let directory: string;
  let filename: string;
  let repository: Repository;
  const connections: Repository[] = [];
  beforeEach(() => {
    directory = mkdtempSync(join(tmpdir(), 'occ-repository-'));
    filename = join(directory, 'test.sqlite');
    repository = createRepository(filename);
    connections.push(repository);
  });
  afterEach(() => {
    connections.splice(0).forEach(connection => connection.close());
    rmSync(directory, { recursive: true, force: true });
  });

  it('persists a conditional save and exposes it through another connection', () => {
    const initial = repository.create(config);
    const input = mutation();
    const result = repository.mutate(initial.document.experimentId, input);
    expect(result).toMatchObject({ ok: true, document: { revision: 2, content: input.content, mutationId: input.mutationId } });
    const reader = createRepository(filename);
    connections.push(reader);
    expect(reader.view(initial.document.experimentId).document).toEqual(result.document);
    expect(reader.view(initial.document.experimentId).events).toEqual([
      expect.objectContaining({ expectedRevision: 1, revision: 2, outcome: 'accepted', operation: 'save' }),
    ]);
  });

  it('rejects a stale write without changing content or creating its checkpoint', () => {
    const { document } = repository.create(config);
    const accepted = repository.mutate(document.experimentId, mutation({ checkpoint: true }));
    const rejected = repository.mutate(document.experimentId, mutation({ clientId: 'B', content: textDocument('stale B'), checkpoint: true }));
    expect(rejected).toEqual({ ok: false, reason: 'conflict', document: accepted.document });
    const view = repository.view(document.experimentId);
    expect(view.document).toEqual(accepted.document);
    expect(view.checkpoints).toHaveLength(1);
    expect(view.checkpoints[0]).toMatchObject({ content: SEED_CONTENT, revision: 1, reason: 'burst' });
    expect(view.events.map(event => event.outcome)).toEqual(['conflict', 'accepted']);
  });

  it('demonstrates last-write-wins and records an overwrite when OCC is disabled', () => {
    const { document } = repository.create({ ...config, occEnabled: false });
    repository.mutate(document.experimentId, mutation());
    const stale = mutation({ clientId: 'B', content: textDocument('B wins from revision 1') });
    expect(repository.mutate(document.experimentId, stale)).toMatchObject({ ok: true, document: { revision: 3, content: stale.content } });
    expect(repository.view(document.experimentId).events[0]).toMatchObject({ expectedRevision: 1, revision: 3, outcome: 'overwritten' });
  });

  it('replays an accepted receipt exactly once even after later writes and changed delays', () => {
    const { document } = repository.create(config);
    const first = mutation({ checkpoint: true });
    const receipt = repository.mutate(document.experimentId, first);
    repository.mutate(document.experimentId, mutation({ expectedRevision: 2 }));
    expect(repository.mutate(document.experimentId, { ...first, requestDelayMs: 4000, responseDelayMs: 3000 })).toEqual(receipt);
    const view = repository.view(document.experimentId);
    expect(view.document.revision).toBe(3);
    expect(view.events).toHaveLength(2);
    expect(view.checkpoints).toHaveLength(1);
  });

  it('replays a conflict receipt without adding events or converting it to a new write', () => {
    const { document } = repository.create(config);
    repository.mutate(document.experimentId, mutation());
    const stale = mutation({ clientId: 'B' });
    const rejected = repository.mutate(document.experimentId, stale);
    repository.mutate(document.experimentId, mutation({ expectedRevision: 2 }));
    expect(repository.mutate(document.experimentId, stale)).toEqual(rejected);
    expect(repository.view(document.experimentId).events).toHaveLength(3);
  });

  it('rejects reuse of a mutation ID for a different intent without changing state', () => {
    const { document } = repository.create(config);
    const first = mutation();
    repository.mutate(document.experimentId, first);
    const before = repository.view(document.experimentId);
    expect(() => repository.mutate(document.experimentId, { ...first, content: textDocument('different') })).toThrow('Mutation ID was already used');
    expect(repository.view(document.experimentId)).toEqual(before);
  });

  it('checkpoints outgoing content only at burst boundaries and preserves it during restore', () => {
    const { document } = repository.create(config);
    const id = document.experimentId;
    repository.mutate(id, mutation({ checkpoint: true }));
    repository.mutate(id, mutation({ expectedRevision: 2, content: textDocument('inside the burst') }));
    expect(repository.view(id).checkpoints).toHaveLength(1);
    repository.mutate(id, mutation({ expectedRevision: 3, checkpoint: true, content: textDocument('next burst') }));
    const before = repository.view(id);
    expect(before.checkpoints.map(checkpoint => checkpoint.revision)).toEqual([3, 1]);
    const restored = repository.mutate(id, mutation({ expectedRevision: 4, content: undefined, restoreCheckpointId: before.checkpoints[1].id }));
    expect(restored).toMatchObject({ ok: true, document: { revision: 5, content: SEED_CONTENT } });
    const after = repository.view(id);
    expect(after.checkpoints[0]).toMatchObject({ revision: 4, content: textDocument('next burst'), reason: 'restore' });
    expect(after.checkpoints.slice(1)).toEqual(before.checkpoints);
    expect(after.events[0]).toMatchObject({ operation: 'restore', outcome: 'accepted', revision: 5 });
  });

  it('rejects stale restores without creating history entries', () => {
    const { document } = repository.create(config);
    const id = document.experimentId;
    repository.mutate(id, mutation({ checkpoint: true }));
    const before = repository.view(id);
    const result = repository.mutate(id, mutation({ content: undefined, restoreCheckpointId: before.checkpoints[0].id }));
    expect(result).toEqual({ ok: false, reason: 'conflict', document: before.document });
    const after = repository.view(id);
    expect(after.checkpoints).toEqual(before.checkpoints);
    expect(after.document).toEqual(before.document);
    expect(after.events[0]).toMatchObject({ operation: 'restore', outcome: 'conflict' });
  });

  it('keeps experiments, checkpoint targets, and receipt identities isolated', () => {
    const first = repository.create(config).document;
    const second = repository.create(config).document;
    const input = mutation({ checkpoint: true });
    repository.mutate(first.experimentId, input);
    const checkpoint = repository.view(first.experimentId).checkpoints[0];
    expect(() => repository.mutate(second.experimentId, mutation({ content: undefined, restoreCheckpointId: checkpoint.id }))).toThrow('Checkpoint not found in this experiment');
    expect(repository.view(second.experimentId)).toMatchObject({ document: second, checkpoints: [], events: [] });
    expect(repository.mutate(second.experimentId, input).ok).toBe(true);
    repository.mutate(first.experimentId, mutation({ expectedRevision: 2 }));
    expect(repository.view(second.experimentId).document.revision).toBe(2);
  });

  it('disables automatic checkpoint creation while continuing to save revisions', () => {
    const { document } = repository.create({ ...config, checkpointsEnabled: false });
    repository.mutate(document.experimentId, mutation({ checkpoint: true }));
    expect(repository.view(document.experimentId)).toMatchObject({ document: { revision: 2 }, checkpoints: [] });
  });

  it('returns explicit errors for missing experiments, content, and checkpoints without partial writes', () => {
    expect(() => repository.view(randomUUID())).toThrow('Experiment not found');
    const { document } = repository.create(config);
    expect(() => repository.mutate(document.experimentId, mutation({ content: undefined }))).toThrow('Missing content');
    expect(() => repository.mutate(document.experimentId, mutation({ content: undefined, restoreCheckpointId: 999 }))).toThrow('Checkpoint not found');
    expect(repository.view(document.experimentId)).toMatchObject({ document, checkpoints: [], events: [] });
  });

  it('accepts exactly one same-revision write racing through independent SQLite connections', async () => {
    const { document } = repository.create(config);
    const barrier = new SharedArrayBuffer(4);
    const gate = new Int32Array(barrier);
    // Load the actual TypeScript repository inside separate Node workers. Each
    // worker opens its own connection, then waits at the same start barrier.
    const source = `
      const { parentPort, workerData } = require('node:worker_threads');
      const fs = require('node:fs');
      const ts = require('typescript');
      require.extensions['.ts'] = (module, filename) => {
        const output = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
          compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true }
        }).outputText;
        module._compile(output, filename);
      };
      const repository = require(workerData.modulePath).createRepository(workerData.filename);
      parentPort.postMessage({ ready: true });
      Atomics.wait(new Int32Array(workerData.barrier), 0, 0);
      const result = repository.mutate(workerData.id, workerData.input);
      repository.close();
      parentPort.postMessage({ result });
    `;
    const workers: Worker[] = [];
    const starts: Promise<void>[] = [];
    const results: Promise<MutationResult>[] = [];
    for (const clientId of ['A', 'B'] as const) {
      const worker = new Worker(source, {
        eval: true, execArgv: [],
        workerData: { modulePath: resolve('src/server/database.ts'), filename, barrier, id: document.experimentId, input: mutation({ clientId, checkpoint: true, content: textDocument(`client ${clientId}`) }) },
      });
      workers.push(worker);
      starts.push(new Promise((resolveReady, reject) => {
        worker.on('message', message => { if (message.ready) resolveReady(); });
        worker.once('error', reject);
      }));
      results.push(new Promise((resolveResult, reject) => {
        worker.on('message', message => { if (message.result) resolveResult(message.result as MutationResult); });
        worker.once('error', reject);
      }));
    }
    try {
      await Promise.all(starts);
      Atomics.store(gate, 0, 1);
      Atomics.notify(gate, 0);
      const outcomes = await Promise.all(results);
      expect(outcomes.filter(outcome => outcome.ok)).toHaveLength(1);
      expect(outcomes.filter(outcome => !outcome.ok)).toHaveLength(1);
      const view = repository.view(document.experimentId);
      expect(view.document.revision).toBe(2);
      expect(view.checkpoints).toHaveLength(1);
      expect(view.events.map(event => event.outcome).sort()).toEqual(['accepted', 'conflict']);
      expect(view.document).toEqual(outcomes.find(outcome => outcome.ok)?.document);
    } finally {
      await Promise.all(workers.map(worker => worker.terminate()));
    }
  });
});
