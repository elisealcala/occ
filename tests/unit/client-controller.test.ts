import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Transport } from '../../src/lib/api';
import { ClientController, type ClientEvent } from '../../src/lib/client-controller';
import { SEED_CONTENT, textDocument, type DocumentSnapshot, type ExperimentView, type Mutation, type MutationResult } from '../../src/lib/contracts';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const initial: DocumentSnapshot = { experimentId: 'experiment-one', content: SEED_CONTENT, revision: 1, clientId: 'seed', mutationId: null, updatedAt: 1 };
const config = { occEnabled: true, checkpointsEnabled: true };
const view = (document: DocumentSnapshot): ExperimentView => ({ config, document, checkpoints: [], events: [] });
const remote = (revision = 2): DocumentSnapshot => ({ ...initial, revision, content: textDocument(`Remote revision ${revision}`), clientId: 'B', mutationId: `remote-${revision}` });
const accepted = (input: Mutation, revision = input.expectedRevision + 1): MutationResult => ({ ok: true, document: { ...initial, revision, content: input.content ?? SEED_CONTENT, clientId: input.clientId, mutationId: input.mutationId } });
async function settle() { for (let step = 0; step < 8; step++) await Promise.resolve(); }

describe('ClientController save and adoption state', () => {
  const controllers: ClientController[] = [];
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(10_000); });
  afterEach(() => { controllers.splice(0).forEach(controller => controller.dispose()); vi.useRealTimers(); });

  function setup(occEnabled = true) {
    const pending: { input: Mutation; experimentId: string; response: ReturnType<typeof deferred<MutationResult>> }[] = [];
    const read = vi.fn<Transport['read']>().mockResolvedValue(view(initial));
    const mutate = vi.fn<Transport['mutate']>((experimentId, input) => {
      const response = deferred<MutationResult>();
      pending.push({ input, experimentId, response });
      return response.promise;
    });
    const events: ClientEvent[] = [];
    const client = new ClientController('A', initial, { ...config, occEnabled }, { read, mutate }, event => events.push(event));
    controllers.push(client);
    return { client, read, mutate, pending, events };
  }

  it('debounces autosave and confirms only the draft that the server accepted', async () => {
    const { client, mutate, pending } = setup();
    client.edit(textDocument('first keystrokes'));
    await vi.advanceTimersByTimeAsync(500);
    expect(mutate).not.toHaveBeenCalled();
    client.edit(textDocument('finished typing'));
    await vi.advanceTimersByTimeAsync(749);
    expect(mutate).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(pending[0].input).toMatchObject({ expectedRevision: 1, content: textDocument('finished typing'), checkpoint: true });
    expect(client.getSnapshot().status).toBe('saving');
    pending[0].response.resolve(accepted(pending[0].input));
    await settle();
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: { revision: 2 }, draft: textDocument('finished typing') });
  });

  it('serializes saves and coalesces queued edits to the newest draft', async () => {
    const { client, mutate, pending } = setup();
    client.configure({ autosave: false });
    client.edit(textDocument('first'));
    const firstSave = client.save();
    client.edit(textDocument('middle'));
    void client.save();
    client.edit(textDocument('latest'));
    void client.save();
    expect(mutate).toHaveBeenCalledTimes(1);
    pending[0].response.resolve(accepted(pending[0].input));
    await firstSave;
    await settle();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(pending[1].input).toMatchObject({ expectedRevision: 2, content: textDocument('latest'), checkpoint: false });
    expect(client.getSnapshot()).toMatchObject({ draft: textDocument('latest'), status: 'saving' });
    pending[1].response.resolve(accepted(pending[1].input));
    await settle();
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: { revision: 3, content: textDocument('latest') } });
  });

  it('keeps newer typing dirty when an older save is acknowledged', async () => {
    const { client, pending } = setup();
    client.configure({ autosave: false });
    client.edit(textDocument('dispatched'));
    const saving = client.save();
    client.edit(textDocument('typed during request'));
    pending[0].response.resolve(accepted(pending[0].input));
    await saving;
    expect(client.getSnapshot()).toMatchObject({ status: 'dirty', draft: textDocument('typed during request'), confirmed: { content: textDocument('dispatched') } });
  });

  it('preserves the local draft and stops queued writes after a 409', async () => {
    const { client, pending, mutate } = setup();
    client.edit(textDocument('local first'));
    const saving = client.save();
    client.edit(textDocument('local latest'));
    void client.save();
    pending[0].response.resolve({ ok: false, reason: 'conflict', document: remote() });
    await saving;
    await vi.advanceTimersByTimeAsync(10_000);
    await client.save();
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({ status: 'conflict', draft: textDocument('local latest'), confirmed: { revision: 1 }, remote: remote() });
  });

  it('preserves a dirty draft and latches a conflict when polling finds an external update', async () => {
    const { client, read, mutate } = setup();
    client.edit(textDocument('unsaved local'));
    read.mockResolvedValueOnce(view(remote()));
    await client.refresh();
    await vi.advanceTimersByTimeAsync(1000);
    expect(client.getSnapshot()).toMatchObject({ status: 'conflict', draft: textDocument('unsaved local'), confirmed: initial, remote: remote() });
    expect(mutate).not.toHaveBeenCalled();
  });

  it('adopts external updates automatically only when the editor is clean', async () => {
    const { client, read } = setup();
    read.mockResolvedValueOnce(view(remote()));
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', draft: remote().content, confirmed: remote(), adoption: 1 });
  });

  it('retains the stale expected revision in unsafe mode after observing newer content', async () => {
    const { client, read, pending } = setup(false);
    client.configure({ autosave: false });
    client.edit(textDocument('intentionally stale'));
    read.mockResolvedValueOnce(view(remote(4)));
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'dirty', confirmed: { revision: 1 }, remote: remote(4) });
    const saving = client.save();
    expect(pending[0].input.expectedRevision).toBe(1);
    pending[0].response.resolve(accepted(pending[0].input, 5));
    await saving;
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: { revision: 5 }, remote: null });
  });

  it('ignores an old read delivered after a newer write acknowledgment', async () => {
    const { client, read, pending } = setup();
    client.configure({ autosave: false });
    const oldRead = deferred<ExperimentView>();
    read.mockReturnValueOnce(oldRead.promise);
    const refreshing = client.refresh();
    client.edit(textDocument('saved while read in flight'));
    const saving = client.save();
    pending[0].response.resolve(accepted(pending[0].input));
    await saving;
    oldRead.resolve(view(initial));
    await refreshing;
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: { revision: 2 }, draft: textDocument('saved while read in flight') });
  });

  it('recognizes its own commit observed before the acknowledgment without discarding new typing', async () => {
    const { client, read, pending } = setup();
    client.configure({ autosave: false });
    client.edit(textDocument('submitted'));
    const saving = client.save();
    client.edit(textDocument('new typing'));
    const receipt = accepted(pending[0].input);
    read.mockResolvedValueOnce(view(receipt.document));
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'saving', confirmed: { revision: 2 }, draft: textDocument('new typing'), remote: null });
    pending[0].response.resolve(receipt);
    await saving;
    expect(client.getSnapshot().status).toBe('dirty');
  });

  it('does not let an older acknowledgment clear a newer external conflict', async () => {
    const { client, read, pending } = setup();
    client.edit(textDocument('my save'));
    const saving = client.save();
    read.mockResolvedValueOnce(view(remote(3)));
    await client.refresh();
    pending[0].response.resolve(accepted(pending[0].input, 2));
    await saving;
    expect(client.getSnapshot()).toMatchObject({ status: 'conflict', remote: remote(3), draft: textDocument('my save') });
  });

  it('invalidates old callbacks and cancels queued intent before adopting server truth', async () => {
    const { client, read, pending, mutate } = setup();
    client.edit(textDocument('in flight'));
    const saving = client.save();
    client.edit(textDocument('queued and discarded'));
    void client.save();
    read.mockResolvedValueOnce(view(remote(4)));
    const adopting = client.goToLatest();
    expect(client.getSnapshot().status).toBe('adopting');
    expect(read).not.toHaveBeenCalled();
    client.edit(textDocument('blocked during adoption'));
    pending[0].response.resolve(accepted(pending[0].input));
    await saving;
    await adopting;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(mutate).toHaveBeenCalledTimes(1);
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: remote(4), draft: remote(4).content, remote: null, adoption: 1 });
  });

  it('retries the same uncertain mutation before sending newer draft content', async () => {
    const { client, pending, mutate } = setup();
    client.configure({ autosave: false });
    client.edit(textDocument('possibly committed'));
    const saving = client.save();
    pending[0].response.reject(new Error('Response disconnected'));
    await saving;
    expect(client.getSnapshot()).toMatchObject({ status: 'error', error: 'Response disconnected', draft: textDocument('possibly committed') });
    client.edit(textDocument('new intent'));
    client.configure({ requestDelayMs: 1000 });
    const retrying = client.save();
    expect(pending[1].input).toEqual(pending[0].input);
    pending[1].response.resolve(accepted(pending[0].input));
    await retrying;
    expect(client.getSnapshot()).toMatchObject({ status: 'dirty', error: null, draft: textDocument('new intent'), confirmed: { revision: 2 } });
    const latest = client.save();
    expect(pending[2].input).toMatchObject({ expectedRevision: 2, content: textDocument('new intent'), requestDelayMs: 1000 });
    expect(pending[2].input.mutationId).not.toBe(pending[0].input.mutationId);
    pending[2].response.resolve(accepted(pending[2].input));
    await latest;
    expect(mutate).toHaveBeenCalledTimes(3);
    expect(client.getSnapshot().status).toBe('saved');
  });

  it('settles an in-flight write that becomes uncertain during adoption before reading latest', async () => {
    const { client, read, pending, mutate } = setup();
    client.edit(textDocument('may already have committed'));
    const saving = client.save();
    client.edit(textDocument('queued content to discard'));
    void client.save();
    const adopting = client.goToLatest();
    expect(client.getSnapshot().status).toBe('adopting');
    pending[0].response.reject(new Error('Connection lost while adopting'));
    await saving;
    await settle();
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(pending[1].input).toEqual(pending[0].input);
    expect(read).not.toHaveBeenCalled();
    expect(client.getSnapshot().status).toBe('adopting');
    const receipt = accepted(pending[0].input);
    read.mockResolvedValueOnce(view(receipt.document));
    pending[1].response.resolve(receipt);
    await adopting;
    await vi.advanceTimersByTimeAsync(10_000);
    expect(read).toHaveBeenCalledTimes(1);
    expect(mutate).toHaveBeenCalledTimes(2);
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', confirmed: receipt.document, draft: textDocument('may already have committed'), error: null, remote: null });
  });

  it('keeps a refresh error separate from the local save state and clears it after recovery', async () => {
    const { client, read } = setup();
    client.configure({ autosave: false });
    client.edit(textDocument('safe local draft'));
    read.mockRejectedValueOnce(new Error('Read unavailable'));
    await client.refresh();
    expect(client.getSnapshot()).toMatchObject({ status: 'dirty', pollError: 'Read unavailable', draft: textDocument('safe local draft') });
    await client.refresh();
    expect(client.getSnapshot().pollError).toBeNull();
  });

  it('keeps the draft when adopting latest fails and allows another adoption attempt', async () => {
    const { client, read } = setup();
    client.edit(textDocument('local draft'));
    read.mockRejectedValueOnce(new Error('Server unavailable'));
    await client.goToLatest();
    expect(client.getSnapshot()).toMatchObject({ status: 'error', error: 'Server unavailable', draft: textDocument('local draft') });
    read.mockResolvedValueOnce(view(remote()));
    await client.goToLatest();
    expect(client.getSnapshot()).toMatchObject({ status: 'saved', error: null, draft: remote().content });
  });

  it('marks the first save of a later editing burst for a checkpoint', async () => {
    const { client, pending } = setup();
    client.configure({ autosave: false, burstGapMs: 10_000 });
    for (const [index, pause] of [0, 1000, 10_000].entries()) {
      await vi.advanceTimersByTimeAsync(pause);
      client.edit(textDocument(`edit ${index}`));
      const saving = client.save();
      expect(pending[index].input.checkpoint).toBe(index !== 1);
      pending[index].response.resolve(accepted(pending[index].input));
      await saving;
    }
  });

  it('applies a restore without replacing typing entered while it was in flight', async () => {
    const { client, pending } = setup();
    client.configure({ autosave: false });
    const restoring = client.save(7);
    expect(pending[0].input).toMatchObject({ restoreCheckpointId: 7, expectedRevision: 1 });
    expect(pending[0].input.content).toBeUndefined();
    client.edit(textDocument('typed during restore'));
    pending[0].response.resolve(accepted(pending[0].input));
    await restoring;
    expect(client.getSnapshot()).toMatchObject({ status: 'dirty', draft: textDocument('typed during restore'), confirmed: { revision: 2, content: SEED_CONTENT } });
  });

  it('cancels scheduled saves and ignores late responses after disposal or experiment reset', async () => {
    const { client, read, pending, mutate } = setup();
    const observer = vi.fn();
    client.subscribe(observer);
    client.edit(textDocument('old experiment'));
    const saving = client.save();
    client.edit(textDocument('must not save after reset'));
    const lateRead = deferred<ExperimentView>();
    read.mockReturnValueOnce(lateRead.promise);
    const reading = client.refresh();
    client.dispose();
    const oldState = client.getSnapshot();
    observer.mockClear();
    const newSnapshot = { ...initial, experimentId: 'experiment-two' };
    const next = new ClientController('A', newSnapshot, config, { read, mutate });
    controllers.push(next);
    pending[0].response.resolve(accepted(pending[0].input));
    lateRead.resolve(view(remote(9)));
    await Promise.all([saving, reading]);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(observer).not.toHaveBeenCalled();
    expect(client.getSnapshot()).toEqual(oldState);
    expect(next.getSnapshot()).toMatchObject({ status: 'saved', confirmed: newSnapshot });
    expect(mutate).toHaveBeenCalledTimes(1);
  });
});
