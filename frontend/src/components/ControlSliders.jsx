export default function ControlSliders({
  force, onForceChange,
  sensorType, onSensorTypeChange,
  scenario, onScenarioChange,
  disabled,
}) {
  return (
    <div className="space-y-4">
      {/* Force slider */}
      <div>
        <div className="flex justify-between text-xs text-zinc-400 mb-1">
          <span>force</span>
          <span className="text-amber-400 tabular-nums">{force.toFixed(1)} N</span>
        </div>
        <input
          type="range"
          min="0.1"
          max="10"
          step="0.1"
          value={force}
          onChange={(e) => onForceChange(parseFloat(e.target.value))}
          className="w-full"
          disabled={disabled}
        />
        <div className="flex justify-between text-[10px] text-zinc-600 mt-0.5">
          <span>0.1</span>
          <span>10 N</span>
        </div>
      </div>

      {/* Sensor type */}
      <div>
        <div className="text-xs text-zinc-400 mb-1">sensor</div>
        <div className="flex gap-2">
          {['gelsight', 'digit'].map((s) => (
            <button
              key={s}
              onClick={() => onSensorTypeChange(s)}
              disabled={disabled}
              className={`
                flex-1 px-3 py-1.5 text-xs rounded border transition-colors
                ${sensorType === s
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'}
                ${disabled ? 'opacity-50' : ''}
              `}
            >
              {s.toUpperCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Scenario */}
      <div>
        <div className="text-xs text-zinc-400 mb-1">scenario</div>
        <div className="flex gap-2">
          {['poke', 'grasp', 'slide'].map((s) => (
            <button
              key={s}
              onClick={() => onScenarioChange(s)}
              disabled={disabled}
              className={`
                flex-1 px-3 py-1.5 text-xs rounded border transition-colors
                ${scenario === s
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-400'
                  : 'border-zinc-700 bg-zinc-900 text-zinc-400 hover:border-zinc-600'}
                ${disabled ? 'opacity-50' : ''}
              `}
            >
              {s}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
