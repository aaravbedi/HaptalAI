"""
Physics validation: controlled force tests for Hertzian pressure maps.

Tests force conservation: integral of pressure over contact area must equal input force.
"""

import os
import sys
import numpy as np

sys.path.insert(0, os.path.dirname(__file__))

from app.simulation import ContactPoint, SimulationResult, ContactScenario, run_contact_simulation
from app.sensor_model import (
    SensorType, generate_pressure_map, compute_effective_modulus,
    hertzian_pressure_at_point, SENSOR_SPECS,
)
from app.heatmap import generate_heatmap_png
from generate_test_meshes import generate_sphere_obj


def generate_box_obj(filepath: str, lx: float, ly: float, lz: float):
    """Generate a box mesh centered at origin. Dimensions in mm."""
    hx, hy, hz = lx / 2, ly / 2, lz / 2
    verts = [
        (-hx, -hy, -hz), (hx, -hy, -hz), (hx, hy, -hz), (-hx, hy, -hz),
        (-hx, -hy, hz), (hx, -hy, hz), (hx, hy, hz), (-hx, hy, hz),
    ]
    faces = [
        (1, 3, 2), (1, 4, 3),  # bottom
        (5, 6, 7), (5, 7, 8),  # top
        (1, 2, 6), (1, 6, 5),  # front
        (3, 4, 8), (3, 8, 7),  # back
        (2, 3, 7), (2, 7, 6),  # right
        (4, 1, 5), (4, 5, 8),  # left
    ]
    with open(filepath, "w") as f:
        f.write(f"# Box {lx}x{ly}x{lz}mm\n")
        for v in verts:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for face in faces:
            f.write(f"f {face[0]} {face[1]} {face[2]}\n")
    print(f"  Wrote box mesh to {filepath}")


def make_synthetic_sim_result(
    force_N: float,
    contact_x: float = 0.0,
    contact_y: float = 0.0,
    num_points: int = 1,
    spread_m: float = 0.0,
) -> SimulationResult:
    """Create a synthetic SimulationResult with exact known force."""
    force_per_point = force_N / num_points
    points = []
    for i in range(num_points):
        if num_points == 1:
            px, py = contact_x, contact_y
        else:
            angle = 2 * np.pi * i / num_points
            px = contact_x + spread_m * np.cos(angle)
            py = contact_y + spread_m * np.sin(angle)
        points.append(ContactPoint(
            position=np.array([px, py, 0.0]),
            normal=np.array([0.0, 0.0, 1.0]),
            normal_force=force_per_point,
            lateral_friction_1=0.0,
            lateral_friction_2=0.0,
        ))
    return SimulationResult(
        contact_points=points,
        object_pose=np.eye(4),
        penetration_depth=0.001,
        mesh_path="synthetic",
    )


def make_box_sim_result(force_N: float, box_half_x_m: float, box_half_y_m: float) -> SimulationResult:
    """
    Simulate a flat box pressing into the membrane.
    Distribute contact points uniformly across the flat face.
    """
    # Grid of contact points across the box face
    nx, ny = 8, 8
    xs = np.linspace(-box_half_x_m, box_half_x_m, nx)
    ys = np.linspace(-box_half_y_m, box_half_y_m, ny)
    force_per_point = force_N / (nx * ny)
    points = []
    for x in xs:
        for y in ys:
            points.append(ContactPoint(
                position=np.array([x, y, 0.0]),
                normal=np.array([0.0, 0.0, 1.0]),
                normal_force=force_per_point,
                lateral_friction_1=0.0,
                lateral_friction_2=0.0,
            ))
    return SimulationResult(
        contact_points=points,
        object_pose=np.eye(4),
        penetration_depth=0.0005,
        mesh_path="synthetic_box",
    )


def analytical_hertzian(F: float, R: float, E_star: float):
    """Return analytical contact radius and peak pressure."""
    a = (3.0 * F * R / (4.0 * E_star)) ** (1.0 / 3.0)
    p0 = (6.0 * F * E_star**2 / (np.pi**3 * R**2)) ** (1.0 / 3.0)
    # Analytical total force check: integral of p(r) over circle = F
    # integral = p0 * (2/3) * pi * a^2 = F  (by definition)
    return a, p0


def run_test(label, sim_result, sensor_type, output_dir, expected_force, R_override=None):
    """Run one test case and print results."""
    specs = SENSOR_SPECS[sensor_type]
    E_star = compute_effective_modulus(specs["gel_young_modulus"], specs["gel_poisson_ratio"])
    taxel_size = specs["sensing_area"] / specs["resolution"]

    tactile = generate_pressure_map(sim_result, sensor_type)
    pm = tactile.pressure_map

    # Integrated force = sum(pressure) * taxel_area
    integrated_force = float(np.sum(pm)) * taxel_size ** 2
    force_error_pct = abs(integrated_force - expected_force) / expected_force * 100

    # Contact area: count taxels above noise threshold
    noise_thresh = specs["noise_std"] * 3
    contact_mask = pm > noise_thresh
    contact_area_mm2 = float(np.sum(contact_mask)) * (taxel_size * 1e3) ** 2

    # Effective contact radius (treating area as circle)
    contact_radius_mm = np.sqrt(contact_area_mm2 / np.pi) if contact_area_mm2 > 0 else 0.0

    # Center pressure (average of center 3x3 region)
    cx, cy = pm.shape[0] // 2, pm.shape[1] // 2
    center_pressure = float(np.mean(pm[cx-1:cx+2, cy-1:cy+2]))
    max_pressure = float(np.max(pm))

    print(f"\n{'='*60}")
    print(f"  {label}")
    print(f"{'='*60}")
    print(f"  Max pressure (peak):     {max_pressure:>12.1f} Pa  ({max_pressure/1e3:.2f} kPa)")
    print(f"  Center pressure (3x3):   {center_pressure:>12.1f} Pa  ({center_pressure/1e3:.2f} kPa)")
    print(f"  Contact area:            {contact_area_mm2:>12.2f} mm²")
    print(f"  Contact radius (equiv):  {contact_radius_mm:>12.2f} mm")
    print(f"  Integrated force:        {integrated_force:>12.4f} N")
    print(f"  Expected force:          {expected_force:>12.4f} N")
    print(f"  Force error:             {force_error_pct:>12.1f} %")

    # Analytical comparison for sphere cases
    if R_override is not None:
        a_theory, p0_theory = analytical_hertzian(expected_force, R_override, E_star)
        print(f"  --- Analytical (Hertzian) ---")
        print(f"  Predicted contact radius:{a_theory*1e3:>12.3f} mm")
        print(f"  Predicted peak pressure: {p0_theory:>12.1f} Pa  ({p0_theory/1e3:.2f} kPa)")

    # Sanity check verdict
    if force_error_pct < 15:
        verdict = "PASS"
    elif force_error_pct < 30:
        verdict = "MARGINAL"
    else:
        verdict = "FAIL"
    print(f"  Force conservation:      {verdict} ({force_error_pct:.1f}% error)")

    # Save heatmap
    heatmap_bytes = generate_heatmap_png(
        pm,
        sensor_area_m=specs["sensing_area"],
        title=label,
    )
    safe = label.replace(" ", "_").replace("(", "").replace(")", "").replace(",", "")
    png_path = os.path.join(output_dir, f"validate_{safe}.png")
    with open(png_path, "wb") as f:
        f.write(heatmap_bytes)
    print(f"  Heatmap saved:           {png_path}")

    return {
        "label": label,
        "max_pressure": max_pressure,
        "center_pressure": center_pressure,
        "contact_area_mm2": contact_area_mm2,
        "contact_radius_mm": contact_radius_mm,
        "integrated_force": integrated_force,
        "expected_force": expected_force,
        "force_error_pct": force_error_pct,
        "verdict": verdict,
        "png_path": png_path,
    }


def main():
    output_dir = os.path.join(os.path.dirname(__file__), "output")
    os.makedirs(output_dir, exist_ok=True)
    mesh_dir = os.path.join(os.path.dirname(__file__), "meshes")
    os.makedirs(mesh_dir, exist_ok=True)

    sensor = SensorType.GELSIGHT

    print("\n" + "=" * 60)
    print("  HaptalAI — Physics Validation (Force Conservation)")
    print("=" * 60)

    # Precompute E* for reference
    specs = SENSOR_SPECS[sensor]
    E_star = compute_effective_modulus(specs["gel_young_modulus"], specs["gel_poisson_ratio"])
    print(f"\n  Sensor: {sensor.value}")
    print(f"  E* = {E_star/1e6:.3f} MPa")
    print(f"  Grid: {specs['resolution']}x{specs['resolution']}, area: {specs['sensing_area']*1e3:.0f}mm")

    results = []

    # ---- Test 1: Sphere 10mm at 1N ----
    sim1 = make_synthetic_sim_result(force_N=1.0)
    r1 = run_test("Sphere R=10mm, F=1N", sim1, sensor, output_dir,
                   expected_force=1.0, R_override=0.01)
    results.append(r1)

    # ---- Test 2: Sphere 10mm at 5N ----
    sim2 = make_synthetic_sim_result(force_N=5.0)
    r2 = run_test("Sphere R=10mm, F=5N", sim2, sensor, output_dir,
                   expected_force=5.0, R_override=0.01)
    results.append(r2)

    # ---- Test 3: Box 20x20x5mm at 3N ----
    box_path = os.path.join(mesh_dir, "box_20x20x5mm.obj")
    generate_box_obj(box_path, 20.0, 20.0, 5.0)
    sim3 = make_box_sim_result(force_N=3.0, box_half_x_m=0.01, box_half_y_m=0.01)
    r3 = run_test("Box 20x20x5mm, F=3N", sim3, sensor, output_dir,
                   expected_force=3.0)
    results.append(r3)

    # ---- Summary ----
    print("\n" + "=" * 60)
    print("  SUMMARY")
    print("=" * 60)
    print(f"  {'Test':<30} {'Max P (kPa)':>12} {'Contact r':>10} {'F_int (N)':>10} {'Error':>8} {'Result':>8}")
    print(f"  {'-'*28:<30} {'-'*12:>12} {'-'*10:>10} {'-'*10:>10} {'-'*8:>8} {'-'*8:>8}")
    for r in results:
        print(f"  {r['label']:<30} {r['max_pressure']/1e3:>12.2f} {r['contact_radius_mm']:>9.2f}mm {r['integrated_force']:>10.4f} {r['force_error_pct']:>7.1f}% {r['verdict']:>8}")

    any_fail = any(r["verdict"] == "FAIL" for r in results)
    if any_fail:
        print("\n  *** FAILURES DETECTED — see analysis below ***")
        for r in results:
            if r["verdict"] == "FAIL":
                print(f"\n  FAILED: {r['label']}")
                print(f"    Expected {r['expected_force']:.2f}N, got {r['integrated_force']:.4f}N")
                print(f"    Error: {r['force_error_pct']:.1f}%")
    else:
        print("\n  All tests passed force conservation check.")

    print()


if __name__ == "__main__":
    main()
