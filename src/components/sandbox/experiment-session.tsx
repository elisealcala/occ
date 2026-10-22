'use client';

import { ArrowDown } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { ClientController, type ClientEvent } from '@/lib/client-controller';
import { textDocument } from '@/lib/contracts';
import type { ResetExperiment, SessionSpec } from '@/lib/experiment-session';
import { runScenario } from '@/lib/scenarios';
import { ClientPanel } from '../client-panel';
import { ArchitectureNotes } from './architecture-notes';
import { CheckpointHistory } from './checkpoint-history';
import { EventTimeline } from './event-timeline';
import { ExperimentControls } from './experiment-controls';
import { ScenarioPanel } from './scenario-panel';
import { ServerPanel } from './server-panel';

export function ExperimentSession({
  initial,
  scenario,
  resetting,
  onReset,
}: SessionSpec & { resetting: boolean; onReset: ResetExperiment }) {
  const [view, setView] = useState(initial);
  const [clientEvents, setClientEvents] = useState<ClientEvent[]>([]);
  const [clients] = useState<[ClientController, ClientController]>(() => {
    const log = (event: ClientEvent) =>
      setClientEvents((events) => [event, ...events].slice(0, 150));
    return [
      new ClientController('A', initial.document, initial.config, api, log),
      new ClientController('B', initial.document, initial.config, api, log),
    ];
  });
  const [serverError, setServerError] = useState<string | null>(null);
  const [scenarioNote, setScenarioNote] = useState<string | null>(null);
  const [scenarioRunning, setScenarioRunning] = useState(!!scenario);
  const [externalBusy, setExternalBusy] = useState(false);
  useEffect(() => {
    let mounted = true;
    let pending = false;
    const refresh = async () => {
      if (pending) return;
      pending = true;
      try {
        const next = await api.read(initial.document.experimentId);
        if (mounted) {
          setView((previous) =>
            next.document.revision >= previous.document.revision ? next : previous,
          );
          setServerError(null);
        }
      } catch (error) {
        if (mounted)
          setServerError(error instanceof Error ? error.message : 'Server observer disconnected');
      } finally {
        pending = false;
      }
    };
    const interval = setInterval(() => void refresh(), 750);
    return () => {
      mounted = false;
      clearInterval(interval);
    };
  }, [initial.document.experimentId]);
  useEffect(() => {
    if (!scenario) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void runScenario(
        scenario,
        clients,
        initial,
        (text) => {
          if (!cancelled) setScenarioNote(text);
        },
        () => cancelled,
      )
        .catch((error) => {
          if (!cancelled) setScenarioNote(`Experiment stopped: ${error.message}`);
        })
        .finally(() => {
          if (!cancelled) setScenarioRunning(false);
        });
    }, 0);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [scenario, clients, initial]);
  const externalWrite = async () => {
    setExternalBusy(true);
    try {
      const latest = await api.read(initial.document.experimentId);
      const result = await api.mutate(initial.document.experimentId, {
        clientId: 'external',
        mutationId: crypto.randomUUID(),
        expectedRevision: latest.document.revision,
        content: textDocument(
          `An external writer changed this document after reading revision ${latest.document.revision}. Your local draft is a separate piece of state.`,
        ),
        checkpoint: true,
        requestDelayMs: 500,
        responseDelayMs: 0,
      });
      if (!result.ok)
        setScenarioNote(
          'The external writer also lost a race. Its stale write was rejected; try again.',
        );
    } catch (error) {
      setScenarioNote(error instanceof Error ? error.message : 'External write failed');
    } finally {
      setExternalBusy(false);
    }
  };
  const busy = resetting || scenarioRunning;
  return (
    <>
      <ExperimentControls
        config={initial.config}
        busy={busy}
        resetting={resetting}
        onReset={onReset}
      />
      <div className="workspace-heading">
        <div>
          <span className="section-index">01 /</span>
          <h2>The workspace</h2>
        </div>
        <span>
          Mode changes start a fresh experiment <span className="muted-dot">·</span>{' '}
          {initial.document.experimentId.slice(0, 8)}
        </span>
      </div>
      <div className="editors-grid">
        <ClientPanel controller={clients[0]} />
        <ClientPanel controller={clients[1]} />
      </div>
      <div className="flow-caption">
        <span />
        <div>
          <ArrowDown size={14} />
          Real HTTP requests <span>·</span> Atomic SQLite writes
          <ArrowDown size={14} />
        </div>
        <span />
      </div>
      <div className="observation-grid">
        <ServerPanel
          document={view.document}
          error={serverError}
          saving={externalBusy}
          busy={busy}
          onExternalWrite={externalWrite}
        />
        <EventTimeline events={view.events} clientEvents={clientEvents} />
      </div>
      <CheckpointHistory
        checkpoints={view.checkpoints}
        enabled={initial.config.checkpointsEnabled}
        clients={clients}
        busy={busy}
      />
      <ScenarioPanel
        scenario={scenario}
        scenarioNote={scenarioNote}
        scenarioRunning={scenarioRunning}
        busy={busy}
        onReset={onReset}
      />
      <ArchitectureNotes />
    </>
  );
}
