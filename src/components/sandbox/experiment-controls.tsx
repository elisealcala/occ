'use client';

import { RotateCcw, ShieldCheck, ShieldOff } from 'lucide-react';
import type { ExperimentConfig } from '@/lib/contracts';
import type { ResetExperiment } from '@/lib/experiment-session';
import { Toggle } from '../controls';

export function ExperimentControls({
  config,
  busy,
  resetting,
  onReset,
}: {
  config: ExperimentConfig;
  busy: boolean;
  resetting: boolean;
  onReset: ResetExperiment;
}) {
  return (
    <div className={`experiment-bar ${config.occEnabled ? '' : 'unsafe'}`}>
      <div className="protection-status">
        {config.occEnabled ? <ShieldCheck size={21} /> : <ShieldOff size={21} />}
        <div>
          <strong>{config.occEnabled ? 'Protected by version checks' : 'Last write wins'}</strong>
          <span>
            {config.occEnabled
              ? 'Stale writes are rejected. Local drafts survive.'
              : 'Stale writes can overwrite newer content.'}
          </span>
        </div>
      </div>
      <div className="experiment-controls">
        <Toggle
          label="OCC protection"
          checked={config.occEnabled}
          disabled={busy}
          onChange={(occEnabled) => void onReset({ ...config, occEnabled })}
        />
        <Toggle
          label="Checkpoints"
          checked={config.checkpointsEnabled}
          disabled={busy}
          onChange={(checkpointsEnabled) => void onReset({ ...config, checkpointsEnabled })}
        />
        <button
          type="button"
          className="reset-button"
          disabled={resetting}
          onClick={() => void onReset(config)}
        >
          <RotateCcw size={15} />
          Reset experiment
        </button>
      </div>
    </div>
  );
}
