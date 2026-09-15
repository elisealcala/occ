'use client';

import { useEffect, useRef, useState, useSyncExternalStore } from 'react';
import Link from 'next/link';
import { ArrowDown, ArrowRight, ArrowUpRight, Check, ChevronDown, Database, FlaskConical, GitBranch, History, LoaderCircle, Play, Radio, RotateCcw, ShieldCheck, ShieldOff, Sparkles, Terminal, Workflow } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { ClientController, type ClientEvent } from '@/lib/client-controller';
import { textDocument, type Checkpoint, type ExperimentConfig, type ExperimentView } from '@/lib/contracts';
import { runScenario, SCENARIOS, type ScenarioId } from '@/lib/scenarios';
import { ClientPanel } from './client-panel';
import { Toggle } from './controls';
import { RichEditor } from './rich-editor';

const STORAGE_KEY = 'occ-sandbox-experiment';
let initialRequest: Promise<ExperimentView> | undefined;
function loadInitial() {
  return initialRequest ??= (async () => {
    let id: string | null = null;
    try { id = localStorage.getItem(STORAGE_KEY); } catch { /* Storage is optional. */ }
    if (id) {
      try { return await api.read(id); }
      catch (error) { if (!(error instanceof ApiError && error.status === 404)) throw error; }
    }
    return api.create({ occEnabled: true, checkpointsEnabled: true });
  })().catch(error => { initialRequest = undefined; throw error; });
}
function remember(view: ExperimentView) {
  try { localStorage.setItem(STORAGE_KEY, view.document.experimentId); } catch { /* Session still works without storage. */ }
}
type SessionSpec = { initial: ExperimentView; scenario?: ScenarioId };

export default function Sandbox() {
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const resetLock = useRef(false);
  const load = () => { void loadInitial().then(initial => { remember(initial); setSession({ initial }); setError(null); }).catch(error => setError(error.message)); };
  useEffect(() => {
    let mounted = true;
    void loadInitial().then(initial => { if (mounted) { remember(initial); setSession({ initial }); } }).catch(error => { if (mounted) setError(error.message); });
    return () => { mounted = false; };
  }, []);
  const reset = async (config: ExperimentConfig, scenario?: ScenarioId) => {
    if (resetLock.current) return;
    resetLock.current = true;
    setResetting(true);
    try {
      const initial = await api.create(config);
      remember(initial);
      initialRequest = Promise.resolve(initial);
      setSession({ initial, scenario });
      setError(null);
    } catch (error) { setError(error instanceof Error ? error.message : 'Could not create experiment'); }
    finally { setResetting(false); resetLock.current = false; }
  };
  return <div className="app-shell">
    <header className="topbar"><Link href="/" className="brand" aria-label="OCC sandbox home"><span className="brand-mark"><GitBranch size={20} /></span><span>occ<span className="brand-slash">/</span><span className="brand-light">sandbox</span></span></Link><div className="topbar-meta"><span className="local-pill"><span />LOCAL ENVIRONMENT</span><span className="stack-label">Next.js <span>+</span> SQLite</span></div></header>
    <main>
      <div className="intro"><div><div className="eyebrow"><FlaskConical size={14} />THE CONCURRENCY LAB</div><h1>Same document.<br /><span>Different versions of the truth.</span></h1><p>Make two clients collide. See what the server accepts.<br className="desktop-break" /> Explore optimistic concurrency control, one save at a time.</p></div><div className="intro-diagram" aria-hidden="true"><span className="diagram-client a">A</span><span className="diagram-wire">→</span><div className="diagram-db"><Database size={30} /><span>ONE SOURCE<br />OF TRUTH</span></div><span className="diagram-wire">←</span><span className="diagram-client b">B</span></div></div>
      {error && <div className="page-error" role="alert">{error} {!session && <button onClick={load}>Retry connection</button>}</div>}
      {session ? <Session key={session.initial.document.experimentId} {...session} resetting={resetting} onReset={reset} /> : !error && <div className="loading-sandbox"><LoaderCircle className="spin" size={22} /><p>Opening your local experiment…</p></div>}
    </main>
    <footer className="page-footer"><span><GitBranch size={14} />OCC Sandbox</span><span>React drafts → version checks → persisted truth</span><span>Built to break. Designed to explain.</span></footer>
  </div>;
}

function Session({ initial, scenario, resetting, onReset }: SessionSpec & { resetting: boolean; onReset: (config: ExperimentConfig, scenario?: ScenarioId) => Promise<void> }) {
  const [view, setView] = useState(initial);
  const [clientEvents, setClientEvents] = useState<ClientEvent[]>([]);
  const [clients] = useState<[ClientController, ClientController]>(() => {
    const log = (event: ClientEvent) => setClientEvents(events => [event, ...events].slice(0, 150));
    return [new ClientController('A', initial.document, initial.config, api, log), new ClientController('B', initial.document, initial.config, api, log)];
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [scenarioNote, setScenarioNote] = useState<string | null>(null);
  const [scenarioRunning, setScenarioRunning] = useState(!!scenario);
  const [externalBusy, setExternalBusy] = useState(false);
  const [preview, setPreview] = useState<Checkpoint | null>(null);
  const [eventTab, setEventTab] = useState<'server' | 'client'>('server');
  const aState = useSyncExternalStore(clients[0].subscribe, clients[0].getSnapshot, clients[0].getSnapshot);
  const bState = useSyncExternalStore(clients[1].subscribe, clients[1].getSnapshot, clients[1].getSnapshot);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await api.read(initial.document.experimentId);
        if (mounted) {
          setView(previous => next.document.revision >= previous.document.revision ? next : previous);
          setServerError(null);
        }
      } catch (error) { if (mounted) setServerError(error instanceof Error ? error.message : 'Server observer disconnected'); }
      finally { pending = false; }
    };
    const interval = setInterval(() => void refresh(), 750);
    return () => { mounted = false; clearInterval(interval); };
  }, [initial.document.experimentId]);
  useEffect(() => {
    if (!scenario) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void runScenario(scenario, clients, initial, text => { if (!cancelled) setScenarioNote(text); }, () => cancelled)
        .catch(error => { if (!cancelled) setScenarioNote(`Experiment stopped: ${error.message}`); })
        .finally(() => { if (!cancelled) setScenarioRunning(false); });
    }, 0);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [scenario, clients, initial]);
  const externalWrite = async () => {
    setExternalBusy(true);
    try {
      const latest = await api.read(initial.document.experimentId);
      const result = await api.mutate(initial.document.experimentId, { clientId: 'external', mutationId: crypto.randomUUID(), expectedRevision: latest.document.revision, content: textDocument(`An external writer changed this document after reading revision ${latest.document.revision}. Your local draft is a separate piece of state.`), checkpoint: true, requestDelayMs: 500, responseDelayMs: 0 });
      if (!result.ok) setScenarioNote('The external writer also lost a race. Its stale write was rejected; try again.');
    } catch (error) { setScenarioNote(error instanceof Error ? error.message : 'External write failed'); }
    finally { setExternalBusy(false); }
  };
  const busy = resetting || scenarioRunning;
  const accepted = view.events.filter(event => event.outcome !== 'conflict').length;
  const conflicts = view.events.filter(event => event.outcome === 'conflict').length;
  const overwritten = view.events.filter(event => event.outcome === 'overwritten').length;
  return <>
    <div className={`experiment-bar ${initial.config.occEnabled ? '' : 'unsafe'}`}>
      <div className="protection-status">{initial.config.occEnabled ? <ShieldCheck size={21} /> : <ShieldOff size={21} />}<div><strong>{initial.config.occEnabled ? 'Protected by version checks' : 'Last write wins'}</strong><span>{initial.config.occEnabled ? 'Stale writes are rejected. Local drafts survive.' : 'Stale writes can overwrite newer content.'}</span></div></div>
      <div className="experiment-controls"><Toggle label="OCC protection" checked={initial.config.occEnabled} disabled={busy} onChange={occEnabled => void onReset({ ...initial.config, occEnabled })} /><Toggle label="Checkpoints" checked={initial.config.checkpointsEnabled} disabled={busy} onChange={checkpointsEnabled => void onReset({ ...initial.config, checkpointsEnabled })} /><button className="reset-button" disabled={resetting} onClick={() => void onReset(initial.config)}><RotateCcw size={15} />Reset experiment</button></div>
    </div>
    <div className="workspace-heading"><div><span className="section-index">01 /</span><h2>The workspace</h2></div><span>Mode changes start a fresh experiment <span className="muted-dot">·</span> {initial.document.experimentId.slice(0, 8)}</span></div>
    <div className="editors-grid"><ClientPanel controller={clients[0]} /><ClientPanel controller={clients[1]} /></div>
    <div className="flow-caption"><span /><div><ArrowDown size={14} />Real HTTP requests <span>·</span> Atomic SQLite writes<ArrowDown size={14} /></div><span /></div>
    <div className="observation-grid">
      <section className="server-panel" aria-label="Server state"><div className="panel-heading"><div><span className="panel-icon"><Database size={18} /></span><h2>Server truth</h2></div><span className="live-badge"><Radio size={12} />{serverError ? 'DISCONNECTED' : 'LIVE'}</span></div><div className="server-revision"><div><span className="eyebrow">PERSISTED REVISION</span><strong>{String(view.document.revision).padStart(2, '0')}</strong></div><div className="server-source"><span>Last writer</span><strong>{view.document.clientId === 'seed' ? 'Initial document' : view.document.clientId === 'external' ? 'External writer' : `Client ${view.document.clientId}`}</strong><span>{view.document.mutationId ? `request ${view.document.mutationId.slice(0, 8)}` : 'Ready for the first edit'}</span></div></div><div className="server-preview"><RichEditor content={view.document.content} label="Persisted server document" /></div>{serverError && <p role="alert" className="error-message">{serverError}</p>}<button className="external-button" disabled={externalBusy || busy} onClick={() => void externalWrite()}><Sparkles size={15} />{externalBusy ? 'External writer saving…' : 'Simulate external writer'}<ArrowUpRight size={15} /></button></section>
      <section className="timeline-panel" aria-label="Event timeline"><div className="panel-heading"><div><span className="panel-icon"><Workflow size={18} /></span><h2>Event timeline</h2></div><div className="event-tabs" role="group" aria-label="Event source"><button aria-pressed={eventTab === 'server'} onClick={() => setEventTab('server')}>Server</button><button aria-pressed={eventTab === 'client'} onClick={() => setEventTab('client')}>Clients</button></div></div><div className="timeline-summary"><span><strong>{accepted}</strong> accepted</span><span><strong>{conflicts}</strong> rejected</span><span><strong>{overwritten}</strong> overwritten</span><span className="timeline-limit">latest 150</span></div><div className="event-list">
      {eventTab === 'server' ? view.events.length ? view.events.map(event => <div className={`event-row ${event.outcome}`} key={event.id}><span className={`event-client ${event.clientId.toLowerCase()}`}>{event.clientId === 'external' ? 'E' : event.clientId}</span><div><div className="event-title"><strong>{event.outcome === 'conflict' ? 'Stale write rejected' : event.outcome === 'overwritten' ? 'Newer content overwritten' : event.operation === 'restore' ? 'Checkpoint restored' : 'Write committed'}</strong><span className={`outcome ${event.outcome}`}>{event.outcome === 'conflict' ? '409' : '200'}</span></div><p>expected <b>r{event.expectedRevision}</b><ArrowRight size={12} />{event.outcome === 'conflict' ? 'server at' : 'committed'} <b>r{event.revision}</b></p><span className="event-meta">{event.mutationId.slice(0, 8)} · {new Date(event.createdAt).toLocaleTimeString([], { hour12: false })}</span></div></div>) : <EmptyEvents /> : clientEvents.length ? clientEvents.map(event => <div className={`event-row ${event.kind}`} key={event.id}><span className={`event-client ${event.clientId.toLowerCase()}`}>{event.clientId}</span><div><div className="event-title"><strong>{event.detail}</strong><span className="client-event-kind">{event.kind}</span></div><span className="event-meta">{event.mutationId ? `${event.mutationId.slice(0, 8)} · ` : ''}{new Date(event.at).toLocaleTimeString([], { hour12: false })}</span></div></div>) : <EmptyEvents />}
      </div></section>
    </div>
    <section className="history-panel" aria-label="Checkpoint history"><details><summary><div><History size={18} /><h2>Checkpoint history</h2><span className="count-badge">{view.checkpoints.length}</span></div><span>Browse & restore <ChevronDown size={15} /></span></summary><div className="history-content"><p>Checkpoints preserve the document before a new editing burst or restore. Live revisions advance with every accepted write.</p>{!initial.config.checkpointsEnabled && <p>Checkpoints are disabled for this experiment.</p>}{!view.checkpoints.length ? <div className="empty-history">No checkpoints yet. Make an edit to preserve your starting point.</div> : <div className="history-layout"><div className="checkpoint-list">{view.checkpoints.map((checkpoint, index) => <button className={preview?.id === checkpoint.id ? 'selected' : ''} key={checkpoint.id} onClick={() => setPreview(checkpoint)}><span><strong>Checkpoint {view.checkpoints.length - index}</strong><span>Revision {checkpoint.revision} · {checkpoint.reason}</span></span><ArrowUpRight size={15} /></button>)}</div><div className="checkpoint-preview">{preview ? <><RichEditor content={preview.content} label="Checkpoint preview" /><div className="restore-actions"><button className="small-button" disabled={['saving', 'conflict', 'adopting', 'error'].includes(aState.status) || busy} onClick={() => void clients[0].save(preview.id)}>Restore through A</button><button className="small-button" disabled={['saving', 'conflict', 'adopting', 'error'].includes(bState.status) || busy} onClick={() => void clients[1].save(preview.id)}>Restore through B</button></div><p>A restore replaces this client’s current draft and uses its last-seen revision. Copy any unsaved text first.</p></> : <p>Select a checkpoint to preview its content.</p>}</div></div>}</div></details></section>
    <section className="scenarios-section" aria-label="Guided experiments"><div className="workspace-heading"><div><span className="section-index">02 /</span><h2>Try breaking things</h2></div><span>Each scenario starts with a fresh document</span></div>{scenarioNote && <div className="scenario-note" role="status">{scenarioRunning ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}<div><strong>{scenarioRunning ? 'Experiment in progress' : 'What happened'}</strong><p>{scenarioNote}</p></div></div>}<div className="scenario-grid">{SCENARIOS.map(item => <button className={`scenario-card ${scenario === item.id ? 'selected' : ''}`} key={item.id} disabled={busy} onClick={() => void onReset({ occEnabled: item.occ, checkpointsEnabled: true }, item.id)}><div><span className="scenario-number">{item.number}</span><Play size={15} /></div><h3>{item.title}</h3><p>{item.description}</p><span className="scenario-mode">{item.occ ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}OCC {item.occ ? 'on' : 'off'}<ArrowUpRight size={14} /></span></button>)}</div></section>
    <details className="explanation"><summary><Terminal size={16} />Under the hood<ChevronDown size={15} /></summary><div><h3>Optimistic means “try, then verify.”</h3><p>Each client reads a revision, edits independently, and sends the revision it saw with its save. SQLite accepts the write only if that revision is still current. If another writer got there first, the server returns 409 and React holds the local draft.</p><pre><code>{'UPDATE experiments\nSET content = ?, revision = revision + 1\nWHERE id = ? AND revision = ?\nRETURNING *;'}</code></pre><p>This sandbox protects checkpoints and restores too. Each client sends one write at a time, keeps newer typing in a separate buffer, and uses a unique mutation ID so a retry cannot commit twice. Polling discovers changes; it does not make stale writes safe.</p><div className="architecture-strip"><span>React draft</span><ArrowRight size={14} /><span>Next.js route</span><ArrowRight size={14} /><span>SQLite transaction</span></div></div></details>
  </>;
}
function EmptyEvents() {
  return <div className="empty-events"><Workflow size={27} /><strong>Every race leaves a trace.</strong><p>Make an edit or run a scenario.<br />Requests and outcomes will appear here.</p></div>;
}
