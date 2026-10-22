'use client';

import { Database, FlaskConical, GitBranch } from 'lucide-react';
import Link from 'next/link';
import type { ReactNode } from 'react';

export function SandboxShell({ children }: { children: ReactNode }) {
  return (
    <div className="app-shell">
      <header className="topbar">
        <Link href="/" className="brand" aria-label="OCC sandbox home">
          <span className="brand-mark">
            <GitBranch size={20} />
          </span>
          <span>
            occ<span className="brand-slash">/</span>
            <span className="brand-light">sandbox</span>
          </span>
        </Link>
        <div className="topbar-meta">
          <span className="local-pill">
            <span />
            LOCAL ENVIRONMENT
          </span>
          <span className="stack-label">
            Next.js <span>+</span> SQLite
          </span>
        </div>
      </header>
      <main>
        <div className="intro">
          <div>
            <div className="eyebrow">
              <FlaskConical size={14} />
              THE CONCURRENCY LAB
            </div>
            <h1>
              Same document.
              <br />
              <span>Different versions of the truth.</span>
            </h1>
            <p>
              Make two clients collide. See what the server accepts.
              <br className="desktop-break" /> Explore optimistic concurrency control, one save at a
              time.
            </p>
          </div>
          <div className="intro-diagram" aria-hidden="true">
            <span className="diagram-client a">A</span>
            <span className="diagram-wire">→</span>
            <div className="diagram-db">
              <Database size={30} />
              <span>
                ONE SOURCE
                <br />
                OF TRUTH
              </span>
            </div>
            <span className="diagram-wire">←</span>
            <span className="diagram-client b">B</span>
          </div>
        </div>
        {children}
      </main>
      <footer className="page-footer">
        <span>
          <GitBranch size={14} />
          OCC Sandbox
        </span>
        <span>React drafts → version checks → persisted truth</span>
        <span>Built to break. Designed to explain.</span>
      </footer>
    </div>
  );
}
