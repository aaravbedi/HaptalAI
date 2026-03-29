export default function StatsReadout({ stats }) {
  const items = [
    { label: 'peak pressure', value: stats.maxPressure, unit: 'kPa', fmt: (v) => (v / 1e3).toFixed(2) },
    { label: 'contact area', value: stats.contactArea, unit: 'mm²', fmt: (v) => v.toFixed(2) },
    { label: 'integrated force', value: stats.integratedForce, unit: 'N', fmt: (v) => v.toFixed(3) },
  ];

  return (
    <div className="grid grid-cols-3 gap-2">
      {items.map(({ label, value, unit, fmt }) => (
        <div key={label} className="bg-zinc-900 border border-zinc-800 rounded px-3 py-2">
          <div className="text-[10px] text-zinc-500 uppercase tracking-wider">{label}</div>
          <div className="text-lg text-zinc-100 tabular-nums leading-tight mt-0.5">
            {value > 0 ? fmt(value) : '—'}
          </div>
          <div className="text-[10px] text-zinc-600">{unit}</div>
        </div>
      ))}
    </div>
  );
}
