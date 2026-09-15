import { api, ApiError, type Transport } from './api';
import { sameContent, type ClientId, type DocumentSnapshot, type ExperimentConfig, type Mutation, type RichNode } from './contracts';

export type ClientSettings = { autosave: boolean; polling: boolean; autosaveDelayMs: number; requestDelayMs: number; responseDelayMs: number; burstGapMs: number };
export const DEFAULT_SETTINGS: ClientSettings = { autosave: true, polling: true, autosaveDelayMs: 750, requestDelayMs: 0, responseDelayMs: 0, burstGapMs: 10_000 };
export type ClientStatus = 'saved' | 'dirty' | 'saving' | 'conflict' | 'error' | 'adopting';
export type ClientState = { draft: RichNode; confirmed: DocumentSnapshot; remote: DocumentSnapshot | null; settings: ClientSettings; status: ClientStatus; error: string | null; pollError: string | null; adoption: number };
export type ClientEvent = { id: string; clientId: ClientId; kind: 'dispatch' | 'ack' | 'conflict' | 'adopt' | 'error' | 'read'; detail: string; mutationId?: string; at: number };

// Framework-independent state machine; React subscribes to stable snapshots.
export class ClientController {
  private state: ClientState;
  private listeners = new Set<() => void>();
  private active = true;
  private epoch = 0;
  private inFlight: Promise<void> | null = null;
  private queued = false;
  private uncertain: Mutation | null = null;
  private ownMutations = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private lastEditAt: number | null = null;
  private checkpointPending = true;
  private highestSeen: number;
  private conflict = false;
  private adopting = false;
  private reading = false;

  constructor(
    public readonly clientId: 'A' | 'B',
    initial: DocumentSnapshot,
    private config: ExperimentConfig,
    private transport: Transport = api,
    private onEvent: (event: ClientEvent) => void = () => {},
  ) {
    this.state = { draft: initial.content, confirmed: initial, remote: null, settings: { ...DEFAULT_SETTINGS }, status: 'saved', error: null, pollError: null, adoption: 0 };
    this.highestSeen = initial.revision;
  }
  getSnapshot = (): ClientState => this.state;
  subscribe = (listener: () => void) => { this.listeners.add(listener); return () => { this.listeners.delete(listener); }; };
  activate() { this.active = true; }
  private emit(kind: ClientEvent['kind'], detail: string, mutationId?: string) {
    if (this.active) this.onEvent({ id: crypto.randomUUID(), clientId: this.clientId, kind, detail, mutationId, at: Date.now() });
  }
  private update(patch: Partial<ClientState> = {}) {
    this.state = { ...this.state, ...patch };
    const status: ClientStatus = this.adopting ? 'adopting' : this.conflict ? 'conflict' : this.state.error ? 'error' : this.inFlight ? 'saving' : this.isDirty() ? 'dirty' : 'saved';
    this.state = { ...this.state, status };
    if (this.active) this.listeners.forEach(listener => listener());
  }
  private isDirty() { return !sameContent(this.state.draft, this.state.confirmed.content); }
  private clearTimer() { if (this.timer) clearTimeout(this.timer); this.timer = null; }
  private schedule() {
    this.clearTimer();
    if (!this.active || !this.state.settings.autosave || this.conflict || this.state.error || this.adopting || !this.isDirty()) return;
    this.timer = setTimeout(() => { this.timer = null; void this.save(); }, this.state.settings.autosaveDelayMs);
  }
  configure = (settings: Partial<ClientSettings>) => {
    this.update({ settings: { ...this.state.settings, ...settings } });
    if (settings.autosave === false) this.queued = false;
    this.schedule();
  };
  edit = (content: RichNode) => {
    if (!this.active || this.adopting || sameContent(content, this.state.draft)) return;
    const now = Date.now();
    if (this.lastEditAt === null || now - this.lastEditAt >= this.state.settings.burstGapMs) this.checkpointPending = true;
    this.lastEditAt = now;
    this.update({ draft: content });
    this.schedule();
  };
  private latch(remote: DocumentSnapshot) {
    this.conflict = true;
    this.queued = false;
    this.clearTimer();
    const latest = this.state.remote && this.state.remote.revision > remote.revision ? this.state.remote : remote;
    this.update({ remote: latest, error: null });
  }
  private observe(incoming: DocumentSnapshot) {
    if (incoming.revision < this.highestSeen) return;
    this.highestSeen = incoming.revision;
    if (incoming.revision <= this.state.confirmed.revision) return;
    if (incoming.mutationId && this.ownMutations.has(incoming.mutationId)) {
      this.update({ confirmed: incoming });
      return;
    }
    if (this.conflict) { this.latch(incoming); return; }
    if (!this.isDirty() && !this.inFlight && !this.uncertain) {
      this.checkpointPending = true;
      this.update({ confirmed: incoming, draft: incoming.content, remote: null, adoption: this.state.adoption + 1 });
    } else if (this.config.occEnabled) {
      this.latch(incoming);
    } else {
      // Leave the read token intact in unsafe mode: the next write is visibly stale.
      this.update({ remote: incoming });
    }
  }
  refresh = async () => {
    if (!this.active || this.reading || this.adopting) return;
    this.reading = true;
    const epoch = this.epoch;
    try {
      const latest = await this.transport.read(this.state.confirmed.experimentId);
      if (!this.active || epoch !== this.epoch) return;
      const changed = latest.document.revision > this.highestSeen;
      this.observe(latest.document);
      this.update({ pollError: null });
      if (changed) this.emit('read', `Observed server revision ${latest.document.revision}`);
    } catch (error) {
      if (this.active && epoch === this.epoch) this.update({ pollError: error instanceof Error ? error.message : 'Refresh failed' });
    } finally { this.reading = false; }
  };
  save = async (restoreCheckpointId?: number): Promise<void> => {
    if (!this.active || this.conflict || this.adopting) return;
    this.clearTimer();
    if (this.inFlight) { if (restoreCheckpointId === undefined) this.queued = true; return this.inFlight; }
    if (!this.uncertain && !this.isDirty() && restoreCheckpointId === undefined) return;
    const retry = this.uncertain;
    const input: Mutation = retry ?? {
      clientId: this.clientId, mutationId: crypto.randomUUID(), expectedRevision: this.state.confirmed.revision,
      ...(restoreCheckpointId === undefined ? { content: this.state.draft } : { restoreCheckpointId }),
      checkpoint: this.checkpointPending,
      requestDelayMs: this.state.settings.requestDelayMs, responseDelayMs: this.state.settings.responseDelayMs,
    };
    const epoch = this.epoch;
    const draftAtDispatch = this.state.draft;
    this.ownMutations.add(input.mutationId);
    if (!retry) this.checkpointPending = false;
    this.uncertain = null;
    this.queued = false;
    this.emit('dispatch', `${retry ? 'Retry' : input.restoreCheckpointId ? 'Restore' : 'Save'} with expected revision ${input.expectedRevision}`, input.mutationId);
    const pending = this.transport.mutate(this.state.confirmed.experimentId, input).then(result => {
      if (!this.active || epoch !== this.epoch) return;
      if (!result.ok) {
        this.emit('conflict', `409 · expected ${input.expectedRevision}, server is ${result.document.revision}`, input.mutationId);
        this.latch(result.document);
        return;
      }
      this.emit('ack', `Committed revision ${result.document.revision}`, input.mutationId);
      this.highestSeen = Math.max(this.highestSeen, result.document.revision);
      const confirmed = result.document.revision >= this.state.confirmed.revision ? result.document : this.state.confirmed;
      // A restore replaces the draft only if no newer keystrokes were entered.
      const draft = input.restoreCheckpointId && sameContent(this.state.draft, draftAtDispatch) ? result.document.content : this.state.draft;
      this.update({ confirmed, draft, error: null, ...(input.restoreCheckpointId ? { adoption: this.state.adoption + 1 } : {}) });
      if (!this.conflict && this.state.remote && this.state.remote.revision <= result.document.revision) this.update({ remote: null });
    }).catch(error => {
      // Even an abandoned callback must retain an uncertain receipt so adoption
      // can settle it before claiming to have read the latest server state.
      const uncertain = !(error instanceof ApiError && error.status >= 400 && error.status < 500);
      this.uncertain = uncertain ? input : null;
      if (!uncertain && input.checkpoint) this.checkpointPending = true;
      if (!this.active || epoch !== this.epoch) return;
      // A disconnected response may already have committed. Retry the exact ID
      // before sending new intent; the server receipt makes this safe.
      const message = error instanceof Error ? error.message : 'Save failed';
      this.emit('error', message, input.mutationId);
      this.update({ error: message });
    }).finally(() => {
      if (this.inFlight === pending) this.inFlight = null;
      if (!this.active || epoch !== this.epoch) return;
      this.update();
      if (this.queued && !this.conflict && !this.state.error) { this.queued = false; void this.save(); }
      else this.schedule();
    });
    this.inFlight = pending;
    this.update({ error: null });
    return pending;
  };
  goToLatest = async () => {
    if (!this.active || this.adopting) return;
    this.adopting = true;
    this.epoch++;
    this.clearTimer();
    this.queued = false;
    this.update();
    try {
      // Cancellation alone cannot undo a committed request. Settle an outstanding
      // request, then read server truth. Old callbacks cannot touch the new epoch.
      await this.inFlight;
      if (!this.active) return;
      if (this.uncertain) {
        await this.transport.mutate(this.state.confirmed.experimentId, this.uncertain);
        this.uncertain = null;
      }
      const latest = await this.transport.read(this.state.confirmed.experimentId);
      if (!this.active) return;
      this.highestSeen = latest.document.revision;
      this.conflict = false;
      this.checkpointPending = true;
      this.lastEditAt = null;
      this.update({ confirmed: latest.document, draft: latest.document.content, remote: null, error: null, pollError: null, adoption: this.state.adoption + 1 });
      this.emit('adopt', `Adopted revision ${latest.document.revision}; queued edits cancelled`);
    } catch (error) {
      if (this.active) this.update({ error: error instanceof Error ? error.message : 'Could not read latest' });
    } finally { this.adopting = false; if (this.active) this.update(); }
  };
  dispose() { this.active = false; this.epoch++; this.clearTimer(); this.queued = false; this.listeners.clear(); }
}
