'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Check, CircleAlert, Copy, RefreshCw, Save, SlidersHorizontal } from 'lucide-react';
import { ClientController } from '@/lib/client-controller';
import { plainText } from '@/lib/contracts';
import { RichEditor } from './rich-editor';
import { Slider, Toggle } from './controls';

const statuses = { saved: 'Saved', dirty: 'Unsaved changes', saving: 'Saving…', conflict: 'Conflict · draft held', error: 'Save failed', adopting: 'Reading latest…' };
export function ClientPanel({ controller }: { controller: ClientController }) {
  const state = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const id = controller.clientId;
  useEffect(() => {
    controller.activate();
    const interval = setInterval(() => { if (controller.getSnapshot().settings.polling) void controller.refresh(); }, 1000);
    return () => { clearInterval(interval); controller.dispose(); };
  }, [controller]);
  const copy = async () => {
    try { await navigator.clipboard.writeText(plainText(state.draft)); setCopied(true); setCopyError(false); }
    catch { setCopyError(true); }
  };
  const blocked = state.status === 'adopting';
  return <section className={`client-panel client-${id.toLowerCase()}`} aria-label={`Client ${id}`}>
    <div className="client-heading"><div className="client-identity"><span className="avatar">{id}</span><div><h2>Client {id}</h2><p>Independent React state</p></div></div><span className="revision" title="This client's last confirmed server revision">rev <strong>{state.confirmed.revision}</strong></span></div>
    <div className="client-switches"><Toggle label="Autosave" checked={state.settings.autosave} onChange={autosave => controller.configure({ autosave })} /><Toggle label="Polling" checked={state.settings.polling} onChange={polling => controller.configure({ polling })} /></div>
    <RichEditor content={state.draft} label={`Client ${id} document`} onChange={controller.edit} disabled={blocked} />
    {state.status === 'conflict' && <div className="conflict-banner" role="alert"><div><CircleAlert size={17} /><strong>The server has a newer revision.</strong></div><p>Your draft is held here. Copy it before choosing Go to latest to replace it.</p><div className="banner-actions"><button onClick={copy}><Copy size={14} />{copied ? 'Copied' : 'Copy draft'}</button><button className="dark-button" onClick={() => void controller.goToLatest()}>Go to latest <span>↗</span></button></div></div>}
    {state.error && <div className="error-message" role="alert">{state.error} <button onClick={() => void controller.save()}>Retry save</button></div>}
    {copyError && <p className="error-message">Clipboard unavailable. Select and copy your draft directly.</p>}
    {state.pollError && <p className="poll-error">Refresh failed. Saved status is unchanged. Try Refresh.</p>}
    <div className="editor-footer"><span className={`save-status ${state.status}`} role="status">{state.status === 'saved' ? <Check size={14} /> : <span className="status-dot" />}{statuses[state.status]}</span><div><button className="text-button" aria-label="Refresh" disabled={blocked} onClick={() => void controller.refresh()}><RefreshCw size={14} />Refresh</button><button className="small-button" disabled={blocked || state.status === 'conflict' || state.status === 'saved'} onClick={() => void controller.save()}><Save size={14} />Save</button></div></div>
    <details className="client-settings"><summary><SlidersHorizontal size={14} />Client timing <span>Customize delays</span></summary><div className="settings-grid"><Slider label="Autosave delay" value={state.settings.autosaveDelayMs} min={250} max={5000} onChange={autosaveDelayMs => controller.configure({ autosaveDelayMs })} /><Slider label="Burst gap" value={state.settings.burstGapMs / 1000} min={1} max={60} step={1} unit="s" onChange={seconds => controller.configure({ burstGapMs: seconds * 1000 })} /><Slider label="Request delay" value={state.settings.requestDelayMs} max={5000} onChange={requestDelayMs => controller.configure({ requestDelayMs })} /><Slider label="Response delay" value={state.settings.responseDelayMs} max={5000} onChange={responseDelayMs => controller.configure({ responseDelayMs })} /></div><p>Request delay happens before the database write. Response delay happens after it commits.</p></details>
  </section>;
}
