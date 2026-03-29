import { useState, useCallback, useMemo } from 'react';
import MeshUploader from './components/MeshUploader';
import MeshViewer from './components/MeshViewer';
import ControlSliders from './components/ControlSliders';
import PressureHeatmap from './components/PressureHeatmap';
import StatsReadout from './components/StatsReadout';
import ColorBar from './components/ColorBar';
import { computePressureMap } from './lib/hertzian';
import { encodeNpy, downloadBlob } from './lib/npy';

const API_BASE = '/api';

export default function App() {
  const [meshFile, setMeshFile] = useState(null);
  const [simData, setSimData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const [force, setForce] = useState(2.0);
  const [sensorType, setSensorType] = useState('gelsight');
  const [scenario, setScenario] = useState('poke');

  // Run simulation when mesh is uploaded
  const handleFileSelected = useCallback(async (file) => {
    setMeshFile(file);
    setError(null);
    setLoading(true);

    try {
      const formData = new FormData();
      formData.append('mesh_file', file);
      formData.append('sensor_type', sensorType);
      formData.append('scenario', scenario);
      formData.append('mesh_scale', '0.001');

      const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Simulation failed (${res.status})`);
      }

      const data = await res.json();
      setSimData(data);
      // Set force to match simulation's actual force
      setForce(Math.round(data.total_sim_force * 10) / 10 || 2.0);
    } catch (err) {
      setError(err.message);
      setSimData(null);
    } finally {
      setLoading(false);
    }
  }, [sensorType, scenario]);

  // Re-run simulation when sensor/scenario changes (if mesh exists)
  const handleSensorChange = useCallback((s) => {
    setSensorType(s);
    if (meshFile) {
      // Need to re-simulate with new sensor specs
      const rerun = async () => {
        setLoading(true);
        try {
          const formData = new FormData();
          formData.append('mesh_file', meshFile);
          formData.append('sensor_type', s);
          formData.append('scenario', scenario);
          formData.append('mesh_scale', '0.001');
          const res = await fetch(`${API_BASE}/simulate`, { method: 'POST', body: formData });
          if (res.ok) setSimData(await res.json());
        } catch (e) { /* keep existing data */ }
        finally { setLoading(false); }
      };
      rerun();
    }
  }, [meshFile, scenario]);

  const handleScenarioChange = useCallback((s) => {
    setScenario(s);
    if (meshFile) {
      const rerun = async () => {
        setLoading(true);
        try {
          const formData = new FormData();
          formData.append('mesh_file', meshFile);
          formData.append('sensor_type', sensorType);
          formData.append('scenario', s);
          formData.append('mesh_scale', '0.001');
          const res = await fetch(`${API_BASE}/simulate`, { method: 'POST', body: formData });
          if (res.ok) setSimData(await res.json());
        } catch (e) { /* keep existing data */ }
        finally { setLoading(false); }
      };
      rerun();
    }
  }, [meshFile, sensorType]);

  // Compute pressure map client-side (instant, no network)
  const pressureResult = useMemo(() => {
    if (!simData) return { map: null, maxPressure: 0, contactArea: 0, integratedForce: 0 };
    return computePressureMap(simData, force, sensorType);
  }, [simData, force, sensorType]);

  // Download .npy
  const handleDownload = useCallback(() => {
    if (!pressureResult.map) return;
    const blob = encodeNpy(pressureResult.map, [64, 64]);
    const name = meshFile
      ? `haptalai_${meshFile.name.replace(/\.[^.]+$/, '')}_${sensorType}_${force}N.npy`
      : 'haptalai_pressure_map.npy';
    downloadBlob(blob, name);
  }, [pressureResult, meshFile, sensorType, force]);

  return (
    <div className="h-screen flex flex-col bg-zinc-950 text-zinc-200">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 shrink-0">
        <div className="flex items-center gap-3">
          <h1 className="text-sm font-bold tracking-tight">
            <span className="text-amber-400">HAPTAL</span>AI
          </h1>
          <span className="text-[10px] text-zinc-600 border border-zinc-800 px-1.5 py-0.5 rounded">
            v0.1.0
          </span>
        </div>
        <div className="text-[10px] text-zinc-600">
          synthetic tactile data generation
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* ─── Left panel ─── */}
        <div className="w-1/2 flex flex-col border-r border-zinc-800 p-4 gap-4 overflow-y-auto">
          {/* Mesh upload */}
          <section>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              mesh input
            </div>
            <MeshUploader onFileSelected={handleFileSelected} disabled={loading} />
          </section>

          {/* 3D preview */}
          <section className="flex-1 min-h-[200px]">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              3d preview
            </div>
            <div className="h-[calc(100%-20px)]">
              <MeshViewer file={meshFile} />
            </div>
          </section>

          {/* Controls */}
          <section>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              parameters
            </div>
            <ControlSliders
              force={force}
              onForceChange={setForce}
              sensorType={sensorType}
              onSensorTypeChange={handleSensorChange}
              scenario={scenario}
              onScenarioChange={handleScenarioChange}
              disabled={loading}
            />
          </section>
        </div>

        {/* ─── Right panel ─── */}
        <div className="w-1/2 flex flex-col p-4 gap-4 overflow-y-auto">
          {/* Status */}
          {loading && (
            <div className="text-xs text-amber-400 bg-amber-400/5 border border-amber-400/20 rounded px-3 py-2">
              running PyBullet simulation...
            </div>
          )}
          {error && (
            <div className="text-xs text-red-400 bg-red-400/5 border border-red-400/20 rounded px-3 py-2">
              {error}
            </div>
          )}

          {/* Heatmap */}
          <section className="flex-1 flex flex-col min-h-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              pressure distribution
            </div>
            <div className="flex gap-3 flex-1 min-h-0 items-start">
              <div className="flex-1">
                <PressureHeatmap
                  pressureMap={pressureResult.map}
                  maxPressure={pressureResult.maxPressure}
                />
              </div>
              <div className="h-[384px] py-1">
                <ColorBar maxValue={pressureResult.maxPressure} />
              </div>
            </div>
          </section>

          {/* Stats */}
          <section>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              measurements
            </div>
            <StatsReadout stats={pressureResult} />
          </section>

          {/* Download */}
          <section>
            <button
              onClick={handleDownload}
              disabled={!pressureResult.map}
              className={`
                w-full px-4 py-2.5 text-xs rounded border transition-colors
                ${pressureResult.map
                  ? 'border-amber-400/50 bg-amber-400/10 text-amber-400 hover:bg-amber-400/20'
                  : 'border-zinc-800 bg-zinc-900 text-zinc-600 cursor-not-allowed'}
              `}
            >
              download pressure_map.npy (64x64 float64)
            </button>
          </section>

          {/* Sim metadata */}
          {simData && (
            <section>
              <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
                simulation metadata
              </div>
              <div className="text-[11px] text-zinc-500 bg-zinc-900 border border-zinc-800 rounded p-3 space-y-1">
                <div>mesh: <span className="text-zinc-300">{simData.mesh_file}</span></div>
                <div>contacts: <span className="text-zinc-300">{simData.contacts?.length || 0}</span></div>
                <div>curvature R: <span className="text-zinc-300">{(simData.curvature_radius * 1e3).toFixed(2)} mm</span></div>
                <div>E*: <span className="text-zinc-300">{(simData.E_star / 1e6).toFixed(3)} MPa</span></div>
                <div>penetration: <span className="text-zinc-300">{(simData.penetration_depth * 1e3).toFixed(3)} mm</span></div>
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
