'use client';

export function Toggle({ label, checked, onChange, disabled = false }: { label: string; checked: boolean; onChange: (value: boolean) => void; disabled?: boolean }) {
  return <label className="toggle-label"><span>{label}</span><button type="button" role="switch" aria-label={label} aria-checked={checked} disabled={disabled} onClick={() => onChange(!checked)} className={`toggle ${checked ? 'on' : ''}`}><span /></button></label>;
}
export function Slider({ label, value, min = 0, max, step = 250, unit = 'ms', onChange }: { label: string; value: number; min?: number; max: number; step?: number; unit?: string; onChange: (value: number) => void }) {
  return <label className="slider-label"><span>{label}<output>{value.toLocaleString()} <span>{unit}</span></output></span><input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={event => onChange(Number(event.target.value))} /></label>;
}
