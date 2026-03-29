import { useRef, useEffect } from 'react';
import { pressureMapToImageData } from '../lib/colormap';

const DISPLAY_SIZE = 384;

export default function PressureHeatmap({ pressureMap, maxPressure }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !pressureMap) return;

    const ctx = canvas.getContext('2d');
    const size = 64;

    // Render pressure map to a small offscreen canvas, then scale up
    const offscreen = new OffscreenCanvas(size, size);
    const offCtx = offscreen.getContext('2d');

    const imageData = pressureMapToImageData(pressureMap, size, maxPressure);
    offCtx.putImageData(imageData, 0, 0);

    // Scale up with nearest-neighbor for that crisp data look
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, DISPLAY_SIZE, DISPLAY_SIZE);
    ctx.drawImage(offscreen, 0, 0, size, size, 0, 0, DISPLAY_SIZE, DISPLAY_SIZE);

  }, [pressureMap, maxPressure]);

  return (
    <canvas
      ref={canvasRef}
      width={DISPLAY_SIZE}
      height={DISPLAY_SIZE}
      className="w-full aspect-square rounded border border-zinc-800 bg-zinc-950"
      style={{ imageRendering: 'pixelated' }}
    />
  );
}
