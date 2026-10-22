'use client';

import { LoaderCircle } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { api } from '@/lib/api';
import type { ExperimentConfig } from '@/lib/contracts';
import {
  loadInitialExperiment,
  rememberExperiment,
  type SessionSpec,
} from '@/lib/experiment-session';
import type { ScenarioId } from '@/lib/scenarios';
import { ExperimentSession } from './sandbox/experiment-session';
import { SandboxShell } from './sandbox/sandbox-shell';

export default function Sandbox() {
  const [session, setSession] = useState<SessionSpec | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const resetLock = useRef(false);
  const load = () => {
    void loadInitialExperiment()
      .then((initial) => {
        rememberExperiment(initial);
        setSession({ initial });
        setError(null);
      })
      .catch((error) => setError(error.message));
  };
  useEffect(() => {
    let mounted = true;
    void loadInitialExperiment()
      .then((initial) => {
        if (mounted) {
          rememberExperiment(initial);
          setSession({ initial });
        }
      })
      .catch((error) => {
        if (mounted) setError(error.message);
      });
    return () => {
      mounted = false;
    };
  }, []);
  const reset = async (config: ExperimentConfig, scenario?: ScenarioId) => {
    if (resetLock.current) return;
    resetLock.current = true;
    setResetting(true);
    try {
      const initial = await api.create(config);
      rememberExperiment(initial);
      setSession({ initial, scenario });
      setError(null);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Could not create experiment');
    } finally {
      setResetting(false);
      resetLock.current = false;
    }
  };
  return (
    <SandboxShell>
      {error && (
        <div className="page-error" role="alert">
          {error}{' '}
          {!session && (
            <button type="button" onClick={load}>
              Retry connection
            </button>
          )}
        </div>
      )}
      {session ? (
        <ExperimentSession
          key={session.initial.document.experimentId}
          {...session}
          resetting={resetting}
          onReset={reset}
        />
      ) : (
        !error && (
          <div className="loading-sandbox">
            <LoaderCircle className="spin" size={22} />
            <p>Opening your local experiment…</p>
          </div>
        )
      )}
    </SandboxShell>
  );
}
