import { useState, useCallback, useMemo, useEffect } from 'react';
import MeshUploader from './components/MeshUploader';
import MeshViewer from './components/MeshViewer';
import ControlSliders from './components/ControlSliders';
import PressureHeatmap from './components/PressureHeatmap';
import StatsReadout from './components/StatsReadout';
import ColorBar from './components/ColorBar';
import { computePressureMap } from './lib/hertzian';
import { encodeNpy, downloadBlob } from './lib/npy';
import { DEMO_SIM_DATA } from './lib/demo-data';

const API_BASE = '/api';

export default function App() {
  const [meshFile, setMeshFile] = useState(null);
  const [simData, setSimData] = useState(null);
  const [serverHeatmap, setServerHeatmap] = useState(null); // base64 PNG from backend
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [demoMode, setDemoMode] = useState(false);

  const [force, setForce] = useState(2.0);
  const [sensorType, setSensorType] = useState('gelsight');
  const [scenario, setScenario] = useState('poke');

  // On mount: check if backend is available, fall back to demo
  useEffect(() => {
    fetch(`${API_BASE}/health`).then(r => {
      if (!r.ok) throw new Error();
    }).catch(() => {
      setDemoMode(true);
      setSimData(DEMO_SIM_DATA);
      setForce(1.0);
    });
  }, []);

  // Upload mesh → POST to backend → get heatmap + stats + contact data
  const runSimulation = useCallback(async (file, sensor, scen) => {
    setError(null);

    if (demoMode) {
      setSimData(DEMO_SIM_DATA);
      return;
    }

    setLoading(true);
    try {
      const formData = new FormData();
      formData.append('mesh_file', file);
      formData.append('sensor_type', sensor);
      formData.append('scenario', scen);
      formData.append('mesh_scale', '0.001');

      const res = await fetch(`${API_BASE}/simulate`, {
        method: 'POST',
        body: formData,
      });

      if (!res.ok) {
        const errData = await res.json().catch(() => ({}));
        throw new Error(errData.detail || `Server error (${res.status})`);
      }

      const data = await res.json();
      setSimData(data);
      setServerHeatmap(data.heatmap_png_b64 || null);
      setForce(Math.round(data.total_sim_force * 10) / 10 || 2.0);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [demoMode]);

  const handleFileSelected = useCallback((file) => {
    setMeshFile(file);
    runSimulation(file, sensorType, scenario);
  }, [sensorType, scenario, runSimulation]);

  const handleSensorChange = useCallback((s) => {
    setSensorType(s);
    if (meshFile) runSimulation(meshFile, s, scenario);
  }, [meshFile, scenario, runSimulation]);

  const handleScenarioChange = useCallback((s) => {
    setScenario(s);
    if (meshFile) runSimulation(meshFile, sensorType, s);
  }, [meshFile, sensorType, runSimulation]);

  // Client-side pressure map for live slider updates
  const pressureResult = useMemo(() => {
    if (!simData) return { map: null, maxPressure: 0, contactArea: 0, integratedForce: 0 };
    return computePressureMap(simData, force, sensorType);
  }, [simData, force, sensorType]);

  // Use server stats when force matches sim force (initial load),
  // otherwise use client-computed stats from slider
  const displayStats = useMemo(() => {
    if (simData?.peak_pressure_Pa && Math.abs(force - (simData.total_sim_force || 0)) < 0.05) {
      return {
        maxPressure: simData.peak_pressure_Pa,
        contactArea: simData.contact_area_mm2,
        integratedForce: simData.integrated_force_N,
      };
    }
    return pressureResult;
  }, [simData, force, pressureResult]);

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
        <div className="flex items-center gap-3">
          {demoMode && (
            <span className="text-[10px] text-cyan-400 border border-cyan-400/30 bg-cyan-400/5 px-1.5 py-0.5 rounded">
              DEMO — 10mm sphere
            </span>
          )}
          <span className="text-[10px] text-zinc-600">
            synthetic tactile data generation
          </span>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex min-h-0">
        {/* ─── Left panel ─── */}
        <div className="w-1/2 flex flex-col border-r border-zinc-800 p-4 gap-4 overflow-y-auto">
          <section>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              mesh input
            </div>
            <MeshUploader onFileSelected={handleFileSelected} disabled={loading} />
          </section>

          <section className="flex-1 min-h-[200px]">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              3d preview
            </div>
            <div className="h-[calc(100%-20px)]">
              <MeshViewer file={meshFile} />
            </div>
          </section>

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

          {/* Heatmap — show server PNG if available, else client-rendered */}
          <section className="flex-1 flex flex-col min-h-0">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              pressure distribution
            </div>
            <div className="flex gap-3 flex-1 min-h-0 items-start">
              <div className="flex-1">
                {serverHeatmap && Math.abs(force - (simData?.total_sim_force || 0)) < 0.05 ? (
                  <img
                    src={`data:image/png;base64,${serverHeatmap}`}
                    alt="Pressure heatmap"
                    className="w-full rounded border border-zinc-800 bg-zinc-950"
                  />
                ) : (
                  <PressureHeatmap
                    pressureMap={pressureResult.map}
                    maxPressure={pressureResult.maxPressure}
                  />
                )}
              </div>
              <div className="h-[384px] py-1">
                <ColorBar maxValue={displayStats.maxPressure} />
              </div>
            </div>
          </section>

          {/* Stats */}
          <section>
            <div className="text-[10px] text-zinc-500 uppercase tracking-wider mb-2">
              measurements
            </div>
            <StatsReadout stats={displayStats} />
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
                {simData.peak_pressure_Pa != null && (
                  <>
                    <div className="border-t border-zinc-800 my-1 pt-1 text-zinc-600">server-computed:</div>
                    <div>peak pressure: <span className="text-zinc-300">{(simData.peak_pressure_Pa / 1e3).toFixed(2)} kPa</span></div>
                    <div>contact area: <span className="text-zinc-300">{simData.contact_area_mm2?.toFixed(2)} mm²</span></div>
                    <div>integrated force: <span className="text-zinc-300">{simData.integrated_force_N?.toFixed(4)} N</span></div>
                  </>
                )}
              </div>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}
