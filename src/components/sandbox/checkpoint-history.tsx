'use client';

import { ArrowUpRight, ChevronDown, History } from 'lucide-react';
import { useState, useSyncExternalStore } from 'react';
import type { ClientController } from '@/lib/client-controller';
import type { Checkpoint } from '@/lib/contracts';
import { RichEditor } from '../rich-editor';

export function CheckpointHistory({
  checkpoints,
  enabled,
  clients,
  busy,
}: {
  checkpoints: Checkpoint[];
  enabled: boolean;
  clients: [ClientController, ClientController];
  busy: boolean;
}) {
  const [preview, setPreview] = useState<Checkpoint | null>(null);
  const aState = useSyncExternalStore(
    clients[0].subscribe,
    clients[0].getSnapshot,
    clients[0].getSnapshot,
  );
  const bState = useSyncExternalStore(
    clients[1].subscribe,
    clients[1].getSnapshot,
    clients[1].getSnapshot,
  );
  return (
    <section className="history-panel" aria-label="Checkpoint history">
      <details>
        <summary>
          <div>
            <History size={18} />
            <h2>Checkpoint history</h2>
            <span className="count-badge">{checkpoints.length}</span>
          </div>
          <span>
            Browse & restore <ChevronDown size={15} />
          </span>
        </summary>
        <div className="history-content">
          <p>
            Checkpoints preserve the document before a new editing burst or restore. Live revisions
            advance with every accepted write.
          </p>
          {!enabled && <p>Checkpoints are disabled for this experiment.</p>}
          {!checkpoints.length ? (
            <div className="empty-history">
              No checkpoints yet. Make an edit to preserve your starting point.
            </div>
          ) : (
            <div className="history-layout">
              <div className="checkpoint-list">
                {checkpoints.map((checkpoint, index) => (
                  <button
                    type="button"
                    className={preview?.id === checkpoint.id ? 'selected' : ''}
                    key={checkpoint.id}
                    onClick={() => setPreview(checkpoint)}
                  >
                    <span>
                      <strong>Checkpoint {checkpoints.length - index}</strong>
                      <span>
                        Revision {checkpoint.revision} · {checkpoint.reason}
                      </span>
                    </span>
                    <ArrowUpRight size={15} />
                  </button>
                ))}
              </div>
              <div className="checkpoint-preview">
                {preview ? (
                  <>
                    <RichEditor content={preview.content} label="Checkpoint preview" />
                    <div className="restore-actions">
                      <button
                        type="button"
                        className="small-button"
                        disabled={
                          ['saving', 'conflict', 'adopting', 'error'].includes(aState.status) ||
                          busy
                        }
                        onClick={() => void clients[0].save(preview.id)}
                      >
                        Restore through A
                      </button>
                      <button
                        type="button"
                        className="small-button"
                        disabled={
                          ['saving', 'conflict', 'adopting', 'error'].includes(bState.status) ||
                          busy
                        }
                        onClick={() => void clients[1].save(preview.id)}
                      >
                        Restore through B
                      </button>
                    </div>
                    <p>
                      A restore replaces this client’s current draft and uses its last-seen
                      revision. Copy any unsaved text first.
                    </p>
                  </>
                ) : (
                  <p>Select a checkpoint to preview its content.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </details>
    </section>
  );
}
