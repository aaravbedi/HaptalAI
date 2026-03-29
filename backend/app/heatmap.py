"""
Heatmap visualization for tactile pressure maps.

Generates publication-quality PNG heatmaps from 64x64 pressure arrays.
"""

import io

import matplotlib
matplotlib.use("Agg")  # non-interactive backend
import matplotlib.pyplot as plt
import numpy as np
from matplotlib.colors import Normalize


def generate_heatmap_png(
    pressure_map: np.ndarray,
    sensor_area_m: float = 0.02,
    title: str = "Tactile Pressure Map",
    colorbar_label: str = "Pressure (Pa)",
    cmap: str = "inferno",
) -> bytes:
    """
    Render a pressure map as a PNG heatmap image.

    Args:
        pressure_map: (H, W) array of pressure values in Pa.
        sensor_area_m: Physical size of the sensor in meters.
        title: Plot title.
        colorbar_label: Label for the colorbar.
        cmap: Matplotlib colormap name.

    Returns:
        PNG image as bytes.
    """
    fig, ax = plt.subplots(1, 1, figsize=(6, 5), dpi=150)

    extent_mm = sensor_area_m * 1000 / 2  # half-width in mm
    extent = [-extent_mm, extent_mm, -extent_mm, extent_mm]

    # Use log-friendly normalization if pressures span wide range
    vmax = np.max(pressure_map)
    vmin = 0.0

    im = ax.imshow(
        pressure_map,
        origin="lower",
        extent=extent,
        cmap=cmap,
        norm=Normalize(vmin=vmin, vmax=vmax),
        interpolation="bilinear",
    )

    ax.set_xlabel("x (mm)")
    ax.set_ylabel("y (mm)")
    ax.set_title(title)

    cbar = fig.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
    cbar.set_label(colorbar_label)

    # Add contact area contour at 10% of max
    if vmax > 0:
        threshold = vmax * 0.1
        ax.contour(
            pressure_map,
            levels=[threshold],
            extent=extent,
            colors="white",
            linewidths=0.8,
            linestyles="--",
        )

    fig.tight_layout()

    buf = io.BytesIO()
    fig.savefig(buf, format="png", bbox_inches="tight")
    plt.close(fig)
    buf.seek(0)
    return buf.read()
