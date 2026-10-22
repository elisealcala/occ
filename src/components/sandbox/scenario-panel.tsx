'use client';

import { ArrowUpRight, Check, LoaderCircle, Play, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ResetExperiment } from '@/lib/experiment-session';
import { SCENARIOS, type ScenarioId } from '@/lib/scenarios';

export function ScenarioPanel({
  scenario,
  scenarioNote,
  scenarioRunning,
  busy,
  onReset,
}: {
  scenario?: ScenarioId;
  scenarioNote: string | null;
  scenarioRunning: boolean;
  busy: boolean;
  onReset: ResetExperiment;
}) {
  return (
    <section className="scenarios-section" aria-label="Guided experiments">
      <div className="workspace-heading">
        <div>
          <span className="section-index">02 /</span>
          <h2>Try breaking things</h2>
        </div>
        <span>Each scenario starts with a fresh document</span>
      </div>
      {scenarioNote && (
        <div className="scenario-note" role="status">
          {scenarioRunning ? <LoaderCircle size={18} className="spin" /> : <Check size={18} />}
          <div>
            <strong>{scenarioRunning ? 'Experiment in progress' : 'What happened'}</strong>
            <p>{scenarioNote}</p>
          </div>
        </div>
      )}
      <div className="scenario-grid">
        {SCENARIOS.map((item) => (
          <button
            type="button"
            className={`scenario-card ${scenario === item.id ? 'selected' : ''}`}
            key={item.id}
            disabled={busy}
            onClick={() =>
              void onReset({ occEnabled: item.occ, checkpointsEnabled: true }, item.id)
            }
          >
            <div>
              <span className="scenario-number">{item.number}</span>
              <Play size={15} />
            </div>
            <h3>{item.title}</h3>
            <p>{item.description}</p>
            <span className="scenario-mode">
              {item.occ ? <ShieldCheck size={12} /> : <ShieldOff size={12} />}OCC{' '}
              {item.occ ? 'on' : 'off'}
              <ArrowUpRight size={14} />
            </span>
          </button>
        ))}
      </div>
    </section>
  );
}
