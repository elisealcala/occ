'use client';

import { ArrowUpRight, Database, FlaskConical, GitBranch, Github, Moon, Sun } from 'lucide-react';
import Link from 'next/link';
import { type ReactNode, useEffect, useSyncExternalStore } from 'react';

const THEME_KEY = 'occ-sandbox-theme';
let fallbackTheme: 'dark' | 'light' = 'dark';

function getTheme(): 'dark' | 'light' {
  try {
    const saved = localStorage.getItem(THEME_KEY);
    return saved === 'light' || saved === 'dark' ? saved : fallbackTheme;
  } catch {
    return fallbackTheme;
  }
}

function subscribeTheme(callback: () => void) {
  window.addEventListener('storage', callback);
  window.addEventListener('occ-theme-change', callback);
  return () => {
    window.removeEventListener('storage', callback);
    window.removeEventListener('occ-theme-change', callback);
  };
}

function ThemeToggle() {
  const theme = useSyncExternalStore(subscribeTheme, getTheme, () => 'dark');
  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  function toggleTheme() {
    const nextTheme = theme === 'dark' ? 'light' : 'dark';
    fallbackTheme = nextTheme;
    try {
      localStorage.setItem(THEME_KEY, nextTheme);
    } catch {
      // The current tab still retains the selected theme when storage is unavailable.
    }
    window.dispatchEvent(new Event('occ-theme-change'));
  }

  return (
    <button
      type="button"
      className="theme-toggle"
      role="switch"
      aria-label="Dark mode"
      aria-checked={theme === 'dark'}
      onClick={toggleTheme}
    >
      {theme === 'dark' ? (
        <Moon size={16} aria-hidden="true" />
      ) : (
        <Sun size={16} aria-hidden="true" />
      )}
      <span>Dark mode</span>
      <span className="theme-toggle-state" aria-hidden="true">
        {theme === 'dark' ? 'On' : 'Off'}
      </span>
    </button>
  );
}

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
            INTERACTIVE LAB
          </span>
          <ThemeToggle />
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
        <a
          className="github-link"
          href="https://github.com/elisealcala/occ"
          target="_blank"
          rel="noopener noreferrer"
        >
          <Github size={16} aria-hidden="true" />
          View on GitHub
          <ArrowUpRight size={16} aria-hidden="true" />
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </footer>
    </div>
  );
}
