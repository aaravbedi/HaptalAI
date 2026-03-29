"""
Generate a simple sphere .obj mesh for testing.

Creates a UV sphere with configurable radius and resolution,
saved as a Wavefront OBJ file.
"""

import math
import os


def generate_sphere_obj(
    filepath: str,
    radius: float = 10.0,  # mm (will be scaled to m by simulation)
    lat_steps: int = 32,
    lon_steps: int = 32,
):
    """Generate a UV sphere mesh and write to .obj file."""
    vertices = []
    faces = []

    # Generate vertices
    for i in range(lat_steps + 1):
        theta = math.pi * i / lat_steps
        for j in range(lon_steps + 1):
            phi = 2.0 * math.pi * j / lon_steps
            x = radius * math.sin(theta) * math.cos(phi)
            y = radius * math.sin(theta) * math.sin(phi)
            z = radius * math.cos(theta)
            vertices.append((x, y, z))

    # Generate faces
    for i in range(lat_steps):
        for j in range(lon_steps):
            v1 = i * (lon_steps + 1) + j + 1        # OBJ is 1-indexed
            v2 = v1 + 1
            v3 = v1 + (lon_steps + 1)
            v4 = v3 + 1
            faces.append((v1, v2, v4))
            faces.append((v1, v4, v3))

    with open(filepath, "w") as f:
        f.write(f"# HaptalAI test sphere: radius={radius}mm\n")
        for v in vertices:
            f.write(f"v {v[0]:.6f} {v[1]:.6f} {v[2]:.6f}\n")
        for face in faces:
            f.write(f"f {face[0]} {face[1]} {face[2]}\n")

    print(f"Wrote sphere mesh ({len(vertices)} verts, {len(faces)} faces) to {filepath}")


if __name__ == "__main__":
    out_dir = os.path.join(os.path.dirname(__file__), "meshes")
    os.makedirs(out_dir, exist_ok=True)
    generate_sphere_obj(os.path.join(out_dir, "sphere_10mm.obj"), radius=10.0)
    generate_sphere_obj(os.path.join(out_dir, "sphere_5mm.obj"), radius=5.0)
    print("Done generating test meshes.")
