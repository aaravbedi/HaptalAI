import { useMemo } from 'react';
import { infernoColor } from '../lib/colormap';

export default function ColorBar({ maxValue }) {
  const gradient = useMemo(() => {
    const stops = [];
    for (let i = 0; i <= 10; i++) {
      const t = i / 10;
      const [r, g, b] = infernoColor(t);
      stops.push(`rgb(${r},${g},${b}) ${t * 100}%`);
    }
    return `linear-gradient(to top, ${stops.join(', ')})`;
  }, []);

  const maxKpa = maxValue > 0 ? (maxValue / 1e3).toFixed(1) : '0';

  return (
    <div className="flex flex-col items-center gap-1 h-full">
      <span className="text-[10px] text-zinc-400 tabular-nums">{maxKpa}</span>
      <div
        className="w-3 flex-1 rounded-sm border border-zinc-800"
        style={{ background: gradient }}
      />
      <span className="text-[10px] text-zinc-400">0</span>
      <span className="text-[9px] text-zinc-600">kPa</span>
    </div>
  );
}
