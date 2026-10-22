'use client';

import { ArrowRight, ChevronDown, Terminal } from 'lucide-react';

export function ArchitectureNotes() {
  return (
    <details className="explanation">
      <summary>
        <Terminal size={16} />
        Under the hood
        <ChevronDown size={15} />
      </summary>
      <div>
        <h3>Optimistic means “try, then verify.”</h3>
        <p>
          Each client reads a revision, edits independently, and sends the revision it saw with its
          save. SQLite accepts the write only if that revision is still current. If another writer
          got there first, the server returns 409 and React holds the local draft.
        </p>
        <pre>
          <code>
            {
              'UPDATE experiments\nSET content = ?, revision = revision + 1\nWHERE id = ? AND revision = ?\nRETURNING *;'
            }
          </code>
        </pre>
        <p>
          This sandbox protects checkpoints and restores too. Each client sends one write at a time,
          keeps newer typing in a separate buffer, and uses a unique mutation ID so a retry cannot
          commit twice. Polling discovers changes; it does not make stale writes safe.
        </p>
        <div className="architecture-strip">
          <span>React draft</span>
          <ArrowRight size={14} />
          <span>Next.js route</span>
          <ArrowRight size={14} />
          <span>SQLite transaction</span>
        </div>
      </div>
    </details>
  );
}
