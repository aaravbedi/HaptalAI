"""
GelSight / DIGIT tactile sensor model.

Converts PyBullet contact simulation results into a 64x64 pressure
distribution map using Hertzian contact mechanics.

Hertzian Contact Theory (sphere-on-flat):
    Contact radius:  a = (3FR / 4E*)^(1/3)
    Max pressure:    p0 = (6FE*^2 / pi^3 R^2)^(1/3)
    Pressure dist:   p(r) = p0 * sqrt(1 - (r/a)^2)  for r <= a

where:
    F = applied normal force
    R = effective radius of curvature at contact
    E* = effective Young's modulus = 1/((1-v1^2)/E1 + (1-v2^2)/E2)

For GelSight: E_gel ~ 0.5 MPa, v_gel ~ 0.48 (silicone)
For rigid object: E_obj -> infinity, so E* ~ E_gel / (1 - v_gel^2)
"""

from dataclasses import dataclass
from enum import Enum

import numpy as np
from scipy.ndimage import gaussian_filter

from .simulation import ContactPoint, SimulationResult


class SensorType(str, Enum):
    GELSIGHT = "gelsight"
    DIGIT = "digit"


# Sensor specifications
SENSOR_SPECS = {
    SensorType.GELSIGHT: {
        "resolution": 64,              # 64x64 taxel grid
        "sensing_area": 0.02,          # 20mm x 20mm physical area
        "gel_thickness": 0.003,         # 3mm
        "gel_young_modulus": 0.5e6,     # 0.5 MPa
        "gel_poisson_ratio": 0.48,
        "noise_std": 5.0,              # Pa noise floor
        "spatial_blur_sigma": 0.8,     # taxel units - gel deformation spread
    },
    SensorType.DIGIT: {
        "resolution": 64,
        "sensing_area": 0.015,          # 15mm x 15mm (DIGIT is smaller)
        "gel_thickness": 0.002,
        "gel_young_modulus": 0.3e6,     # softer gel
        "gel_poisson_ratio": 0.48,
        "noise_std": 8.0,
        "spatial_blur_sigma": 1.0,
    },
}


@dataclass
class TactileOutput:
    """Output of the tactile sensor model."""
    pressure_map: np.ndarray     # (64, 64) pressure in Pa
    max_pressure: float          # Pa
    total_force: float           # N (integrated)
    contact_area: float          # m^2 (estimated)
    sensor_type: SensorType
    metadata: dict


def compute_effective_modulus(E_gel: float, v_gel: float) -> float:
    """
    Compute effective Young's modulus E* for gel-rigid contact.
    Since E_object >> E_gel: E* ≈ E_gel / (1 - v_gel^2)
    """
    return E_gel / (1.0 - v_gel ** 2)


def hertzian_pressure_at_point(
    force: float,
    radius_of_curvature: float,
    E_star: float,
    r: np.ndarray,
) -> np.ndarray:
    """
    Compute Hertzian pressure distribution p(r) for a sphere-on-flat contact.

    Args:
        force: Normal force at this contact (N).
        radius_of_curvature: Effective radius of curvature (m).
        E_star: Effective Young's modulus (Pa).
        r: Array of radial distances from contact center (m).

    Returns:
        Pressure array (Pa), zero outside contact circle.
    """
    if force <= 0 or radius_of_curvature <= 0:
        return np.zeros_like(r)

    # Hertzian contact radius
    a = (3.0 * force * radius_of_curvature / (4.0 * E_star)) ** (1.0 / 3.0)

    # Peak pressure
    p0 = (6.0 * force * E_star ** 2 / (np.pi ** 3 * radius_of_curvature ** 2)) ** (1.0 / 3.0)

    # Pressure distribution: p(r) = p0 * sqrt(1 - (r/a)^2)
    ratio = r / a
    pressure = np.where(ratio <= 1.0, p0 * np.sqrt(np.maximum(0.0, 1.0 - ratio ** 2)), 0.0)

    return pressure


def estimate_local_curvature(
    contact_points: list[ContactPoint],
    default_radius: float = 0.01,
) -> float:
    """
    Estimate the effective radius of curvature from contact point distribution.
    Falls back to default_radius if not enough points.
    """
    if len(contact_points) < 3:
        return default_radius

    positions = np.array([cp.position for cp in contact_points])

    # Spread of contact points gives a rough sense of curvature
    # For a sphere of radius R pressing into a flat surface,
    # the contact patch radius a ~ sqrt(R * d) where d is penetration
    spread = np.std(positions[:, :2], axis=0)
    avg_spread = np.mean(spread)

    if avg_spread < 1e-6:
        return default_radius

    # Rough estimate: R ~ spread^2 / (2 * avg_penetration)
    # Use z-variation as proxy for penetration profile
    z_range = np.ptp(positions[:, 2])
    if z_range < 1e-7:
        return default_radius

    R_est = avg_spread ** 2 / (2.0 * z_range)
    return np.clip(R_est, 0.005, 0.1)  # bound between 5mm and 10cm


def generate_pressure_map(
    sim_result: SimulationResult,
    sensor_type: SensorType,
) -> TactileOutput:
    """
    Generate a 64x64 pressure distribution map from simulation contact data.

    Uses Hertzian contact theory to distribute force at each contact point
    into a realistic pressure profile on the sensor grid.
    """
    specs = SENSOR_SPECS[sensor_type]
    res = specs["resolution"]
    area_size = specs["sensing_area"]
    E_star = compute_effective_modulus(specs["gel_young_modulus"], specs["gel_poisson_ratio"])

    # Initialize pressure grid
    pressure_map = np.zeros((res, res), dtype=np.float64)

    # Taxel size
    taxel_size = area_size / res  # meters per taxel

    # Create coordinate grids (physical coordinates centered on sensor)
    x_coords = np.linspace(-area_size / 2, area_size / 2, res)
    y_coords = np.linspace(-area_size / 2, area_size / 2, res)
    xx, yy = np.meshgrid(x_coords, y_coords)

    contact_points = sim_result.contact_points

    if not contact_points:
        return TactileOutput(
            pressure_map=pressure_map,
            max_pressure=0.0,
            total_force=0.0,
            contact_area=0.0,
            sensor_type=sensor_type,
            metadata={"num_contacts": 0, "warning": "No contact detected"},
        )

    # Estimate local curvature from contact geometry
    R_eff = estimate_local_curvature(contact_points)

    # Distribute total force: if PyBullet gives few contact points,
    # we redistribute the total force proportionally
    total_sim_force = sum(cp.normal_force for cp in contact_points)

    for cp in contact_points:
        # Map contact position to sensor grid coordinates
        cx, cy = cp.position[0], cp.position[1]

        # Radial distance from this contact point to every taxel
        r_grid = np.sqrt((xx - cx) ** 2 + (yy - cy) ** 2)

        # Compute Hertzian pressure contribution from this contact
        force_at_contact = cp.normal_force
        if force_at_contact < 1e-6:
            continue

        pressure_contribution = hertzian_pressure_at_point(
            force=force_at_contact,
            radius_of_curvature=R_eff,
            E_star=E_star,
            r=r_grid,
        )

        pressure_map += pressure_contribution

    # Apply spatial blur to simulate gel deformation spreading
    pressure_map = gaussian_filter(pressure_map, sigma=specs["spatial_blur_sigma"])

    # Add sensor noise
    noise = np.random.normal(0, specs["noise_std"], size=(res, res))
    pressure_map = np.maximum(0.0, pressure_map + noise)

    # Compute summary statistics
    max_pressure = float(np.max(pressure_map))
    contact_mask = pressure_map > specs["noise_std"] * 3
    contact_area = float(np.sum(contact_mask)) * taxel_size ** 2
    total_force_integrated = float(np.sum(pressure_map)) * taxel_size ** 2

    metadata = {
        "num_contacts": len(contact_points),
        "total_sim_force_N": total_sim_force,
        "effective_curvature_radius_m": R_eff,
        "E_star_Pa": E_star,
        "taxel_size_m": taxel_size,
        "sensor_area_m": area_size,
    }

    return TactileOutput(
        pressure_map=pressure_map,
        max_pressure=max_pressure,
        total_force=total_force_integrated,
        contact_area=contact_area,
        sensor_type=sensor_type,
        metadata=metadata,
    )
