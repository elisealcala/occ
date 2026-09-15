import { api } from './api';
import { ClientController } from './client-controller';
import { textDocument, type ExperimentView } from './contracts';

export const SCENARIOS = [
  { id: 'conflict', number: '01', title: 'Catch a collision', description: 'Two clients save the same revision. Only one wins.', occ: true },
  { id: 'lost-update', number: '02', title: 'Lose an update', description: 'Remove the version check. See what gets overwritten.', occ: false },
  { id: 'slow-save', number: '03', title: 'Type through a slow save', description: 'Keep editing while an earlier save is in flight.', occ: true },
  { id: 'external', number: '04', title: 'Meet another writer', description: 'Hold a local draft while an external writer saves.', occ: true },
  { id: 'history', number: '05', title: 'Travel through history', description: 'Restore a checkpoint, then reject a stale restore.', occ: true },
] as const;
export type ScenarioId = typeof SCENARIOS[number]['id'];
const pause = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

export async function runScenario(id: ScenarioId, clients: [ClientController, ClientController], initial: ExperimentView, note: (text: string) => void, cancelled: () => boolean) {
  const [a, b] = clients;
  const experimentId = initial.document.experimentId;
  for (const client of clients) client.configure({ autosave: false, polling: false, requestDelayMs: 0, responseDelayMs: 0 });
  if (id === 'conflict' || id === 'lost-update') {
    note('Both clients read revision 1. A will save first; B will arrive with the same old token.');
    a.edit(textDocument('Client A: a carefully written first edit.'));
    b.edit(textDocument('Client B: a different edit from the same starting point.'));
    b.configure({ requestDelayMs: 900 });
    await Promise.all([a.save(), b.save()]);
    if (cancelled()) return;
    note(id === 'conflict' ? 'A committed revision 2. B received 409 and kept its draft. Copy the draft or choose Go to latest to resolve it.' : 'Both saves were accepted. B replaced A’s work at revision 3. The timeline marks the stale write as an overwrite.');
  } else if (id === 'slow-save') {
    a.configure({ responseDelayMs: 1600 });
    a.edit(textDocument('First sentence.'));
    note('The first save commits, but its response is delayed. New typing stays in the editor.');
    const first = a.save();
    await pause(300);
    if (cancelled()) return;
    a.edit(textDocument('First sentence. And the newest sentence, typed while saving.'));
    void a.save();
    await first;
    if (cancelled()) return;
    await a.save();
    note('The latest draft persisted at revision 3. This client serialized its saves; the earlier acknowledgment never replaced newer typing.');
  } else if (id === 'external') {
    a.edit(textDocument('My local draft deserves to survive.'));
    note('A has unsaved typing. An external writer is saving a different document.');
    await pause(350);
    if (cancelled()) return;
    await api.mutate(experimentId, { clientId: 'external', mutationId: crypto.randomUUID(), expectedRevision: 1, content: textDocument('An external writer updated the shared document.'), checkpoint: true, requestDelayMs: 0, responseDelayMs: 0 });
    if (cancelled()) return;
    await a.refresh();
    await b.refresh();
    note('A holds its draft and shows the conflict. B had no local changes and adopted revision 2. Use Go to latest in A to finish.');
  } else {
    note('A will save a new burst, preserve revision 1, and restore that checkpoint. B will try the same restore using a stale token.');
    a.edit(textDocument('A new revision, ready to checkpoint.'));
    await a.save();
    if (cancelled()) return;
    const view = await api.read(experimentId);
    const checkpoint = view.checkpoints[0];
    if (!checkpoint) throw new Error('Expected a checkpoint for this scenario');
    await a.save(checkpoint.id);
    if (cancelled()) return;
    await b.save(checkpoint.id);
    note('A restored the starting document at revision 3 and preserved the outgoing content. B’s stale restore was rejected without creating another checkpoint.');
  }
}
