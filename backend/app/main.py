"""
HaptalAI Backend — FastAPI application for synthetic tactile data generation.

Endpoints:
    POST /generate  — Upload mesh + params, get back heatmap PNG + .npy array
    GET  /health    — Health check
"""

import io
import os
import tempfile
import zipfile
from typing import Annotated

import numpy as np
from fastapi import FastAPI, File, Form, HTTPException, UploadFile
from fastapi.responses import Response, StreamingResponse

from .heatmap import generate_heatmap_png
from .sensor_model import SensorType, generate_pressure_map
from .simulation import ContactScenario, run_contact_simulation

app = FastAPI(
    title="HaptalAI",
    description="Synthetic tactile data generation for robotics",
    version="0.1.0",
)

ALLOWED_EXTENSIONS = {".obj", ".stl"}
MAX_FILE_SIZE = 50 * 1024 * 1024  # 50MB


@app.get("/health")
async def health():
    return {"status": "ok", "version": "0.1.0"}


@app.post("/generate")
async def generate_tactile_data(
    mesh_file: Annotated[UploadFile, File(description="3D mesh file (.obj or .stl)")],
    sensor_type: Annotated[str, Form(description="Sensor type: gelsight or digit")] = "gelsight",
    scenario: Annotated[str, Form(description="Contact scenario: grasp, poke, or slide")] = "poke",
    mesh_scale: Annotated[float, Form(description="Mesh scale factor (default: 0.001 for mm->m)")] = 0.001,
):
    """
    Generate synthetic tactile sensor data from a 3D mesh.

    Upload a .obj or .stl mesh file along with sensor and scenario parameters.
    Returns a ZIP containing:
      - pressure_map.npy: 64x64 numpy array of pressure values (Pa)
      - heatmap.png: Visualization of the pressure distribution
      - metadata.json: Simulation and sensor parameters
    """
    # Validate file extension
    filename = mesh_file.filename or "mesh.obj"
    ext = os.path.splitext(filename)[1].lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(400, f"Unsupported file type '{ext}'. Use .obj or .stl")

    # Validate sensor type
    try:
        sensor = SensorType(sensor_type.lower())
    except ValueError:
        raise HTTPException(400, f"Unknown sensor type '{sensor_type}'. Use 'gelsight' or 'digit'")

    # Validate scenario
    try:
        contact_scenario = ContactScenario(scenario.lower())
    except ValueError:
        raise HTTPException(400, f"Unknown scenario '{scenario}'. Use 'grasp', 'poke', or 'slide'")

    # Read and save mesh to temp file
    content = await mesh_file.read()
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(400, f"File too large (max {MAX_FILE_SIZE // 1024 // 1024}MB)")

    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        tmp.write(content)
        tmp_path = tmp.name

    try:
        # Run PyBullet simulation
        sim_result = run_contact_simulation(
            mesh_path=tmp_path,
            scenario=contact_scenario,
            mesh_scale=mesh_scale,
        )

        # Generate pressure map using sensor model
        tactile_output = generate_pressure_map(sim_result, sensor)

        # Generate heatmap PNG
        heatmap_bytes = generate_heatmap_png(
            tactile_output.pressure_map,
            sensor_area_m=tactile_output.metadata.get("sensor_area_m", 0.02),
            title=f"HaptalAI — {sensor.value.upper()} / {contact_scenario.value}",
        )

        # Save numpy array to bytes
        npy_buf = io.BytesIO()
        np.save(npy_buf, tactile_output.pressure_map)
        npy_bytes = npy_buf.getvalue()

        # Build metadata JSON
        import json
        metadata = {
            "sensor_type": sensor.value,
            "scenario": contact_scenario.value,
            "mesh_file": filename,
            "mesh_scale": mesh_scale,
            "max_pressure_Pa": tactile_output.max_pressure,
            "total_force_N": tactile_output.total_force,
            "contact_area_m2": tactile_output.contact_area,
            "resolution": 64,
            **tactile_output.metadata,
        }
        metadata_bytes = json.dumps(metadata, indent=2, default=str).encode()

        # Package into ZIP
        zip_buf = io.BytesIO()
        with zipfile.ZipFile(zip_buf, "w", zipfile.ZIP_DEFLATED) as zf:
            zf.writestr("pressure_map.npy", npy_bytes)
            zf.writestr("heatmap.png", heatmap_bytes)
            zf.writestr("metadata.json", metadata_bytes)
        zip_buf.seek(0)

        return StreamingResponse(
            zip_buf,
            media_type="application/zip",
            headers={"Content-Disposition": f"attachment; filename=haptalai_output.zip"},
        )

    except Exception as e:
        raise HTTPException(500, f"Simulation failed: {str(e)}")

    finally:
        os.unlink(tmp_path)
