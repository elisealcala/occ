'use client';

import { ArrowUpRight, Database, Radio, Sparkles } from 'lucide-react';
import type { DocumentSnapshot } from '@/lib/contracts';
import { RichEditor } from '../rich-editor';

export function ServerPanel({
  document,
  error,
  saving,
  busy,
  onExternalWrite,
}: {
  document: DocumentSnapshot;
  error: string | null;
  saving: boolean;
  busy: boolean;
  onExternalWrite: () => Promise<void>;
}) {
  return (
    <section className="server-panel" aria-label="Server state">
      <div className="panel-heading">
        <div>
          <span className="panel-icon">
            <Database size={18} />
          </span>
          <h2>Server truth</h2>
        </div>
        <span className="live-badge">
          <Radio size={12} />
          {error ? 'DISCONNECTED' : 'LIVE'}
        </span>
      </div>
      <div className="server-revision">
        <div>
          <span className="eyebrow">PERSISTED REVISION</span>
          <strong>{String(document.revision).padStart(2, '0')}</strong>
        </div>
        <div className="server-source">
          <span>Last writer</span>
          <strong>
            {document.clientId === 'seed'
              ? 'Initial document'
              : document.clientId === 'external'
                ? 'External writer'
                : `Client ${document.clientId}`}
          </strong>
          <span>
            {document.mutationId
              ? `request ${document.mutationId.slice(0, 8)}`
              : 'Ready for the first edit'}
          </span>
        </div>
      </div>
      <div className="server-preview">
        <RichEditor content={document.content} label="Persisted server document" />
      </div>
      {error && (
        <p role="alert" className="error-message">
          {error}
        </p>
      )}
      <button
        type="button"
        className="external-button"
        disabled={saving || busy}
        onClick={() => void onExternalWrite()}
      >
        <Sparkles size={15} />
        {saving ? 'External writer saving…' : 'Simulate external writer'}
        <ArrowUpRight size={15} />
      </button>
    </section>
  );
}
