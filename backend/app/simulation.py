"""
PyBullet contact simulation for tactile sensor data generation.

Simulates a rigid object pressing against a flat GelSight-style
elastomeric membrane and extracts contact point data.
"""

import os
import tempfile
import time
from dataclasses import dataclass
from enum import Enum

import numpy as np
import pybullet as p
import pybullet_data


class ContactScenario(str, Enum):
    GRASP = "grasp"
    POKE = "poke"
    SLIDE = "slide"


@dataclass
class ContactPoint:
    """A single contact point from the PyBullet simulation."""
    position: np.ndarray       # world-frame [x, y, z]
    normal: np.ndarray         # contact normal pointing into membrane
    normal_force: float        # magnitude of normal force (N)
    lateral_friction_1: float
    lateral_friction_2: float


@dataclass
class SimulationResult:
    """Result of a PyBullet contact simulation."""
    contact_points: list[ContactPoint]
    object_pose: np.ndarray    # 4x4 transform
    penetration_depth: float   # max penetration (m)
    mesh_path: str


# Scenario-specific parameters
SCENARIO_PARAMS = {
    ContactScenario.GRASP: {
        "push_velocity": -0.02,    # m/s downward
        "push_duration": 0.8,      # seconds
        "lateral_velocity": 0.0,
        "force_target": 2.0,       # N - typical grasp force
    },
    ContactScenario.POKE: {
        "push_velocity": -0.05,
        "push_duration": 0.4,
        "lateral_velocity": 0.0,
        "force_target": 5.0,
    },
    ContactScenario.SLIDE: {
        "push_velocity": -0.03,
        "push_duration": 0.3,
        "lateral_velocity": 0.01,  # m/s lateral slide after contact
        "force_target": 1.5,
    },
}

# Membrane physical properties (silicone elastomer)
MEMBRANE_THICKNESS = 0.003      # 3mm
MEMBRANE_YOUNG_MODULUS = 0.5e6  # 0.5 MPa (soft silicone)
MEMBRANE_POISSON_RATIO = 0.48   # nearly incompressible


def run_contact_simulation(
    mesh_path: str,
    scenario: ContactScenario,
    mesh_scale: float = 0.001,  # default: mesh units are mm -> convert to m
) -> SimulationResult:
    """
    Run a PyBullet contact simulation of a rigid mesh pressing against
    a flat elastomeric membrane (GelSight-style sensor surface).

    Args:
        mesh_path: Path to .obj or .stl mesh file.
        scenario: Contact scenario type.
        mesh_scale: Scale factor for the mesh (default mm->m).

    Returns:
        SimulationResult with contact point data.
    """
    params = SCENARIO_PARAMS[scenario]

    # Start PyBullet in DIRECT mode (no GUI)
    physics_client = p.connect(p.DIRECT)
    try:
        p.setAdditionalSearchPath(pybullet_data.getDataPath())
        p.setGravity(0, 0, -9.81)
        p.setTimeStep(1.0 / 240.0)

        # Create the membrane as a flat box (sensor surface)
        membrane_half_extents = [0.02, 0.02, MEMBRANE_THICKNESS / 2]
        membrane_collision = p.createCollisionShape(
            p.GEOM_BOX, halfExtents=membrane_half_extents
        )
        membrane_visual = p.createVisualShape(
            p.GEOM_BOX,
            halfExtents=membrane_half_extents,
            rgbaColor=[0.7, 0.7, 0.9, 0.8],
        )
        membrane_body = p.createMultiBody(
            baseMass=0,  # static
            baseCollisionShapeIndex=membrane_collision,
            baseVisualShapeIndex=membrane_visual,
            basePosition=[0, 0, 0],
        )

        # Set membrane friction and contact properties
        p.changeDynamics(
            membrane_body, -1,
            lateralFriction=1.0,
            restitution=0.1,
            contactStiffness=MEMBRANE_YOUNG_MODULUS * 0.01,
            contactDamping=100.0,
        )

        # Load the mesh as the object to press against the membrane
        mesh_collision = p.createCollisionShape(
            p.GEOM_MESH,
            fileName=mesh_path,
            meshScale=[mesh_scale] * 3,
        )
        mesh_visual = p.createVisualShape(
            p.GEOM_MESH,
            fileName=mesh_path,
            meshScale=[mesh_scale] * 3,
            rgbaColor=[0.9, 0.5, 0.3, 1.0],
        )

        # Position object above the membrane
        start_height = 0.03  # 3cm above membrane
        object_body = p.createMultiBody(
            baseMass=0.1,  # 100g
            baseCollisionShapeIndex=mesh_collision,
            baseVisualShapeIndex=mesh_visual,
            basePosition=[0, 0, start_height],
        )

        p.changeDynamics(
            object_body, -1,
            lateralFriction=0.8,
            restitution=0.05,
        )

        # Phase 1: Push object down toward membrane
        steps_push = int(params["push_duration"] * 240)
        contact_points_raw = []

        for step in range(steps_push):
            # Apply downward velocity
            current_vel = list(p.getBaseVelocity(object_body)[0])
            current_vel[2] = params["push_velocity"]

            if params["lateral_velocity"] > 0 and step > steps_push // 2:
                current_vel[0] = params["lateral_velocity"]

            p.resetBaseVelocity(object_body, linearVelocity=current_vel)
            p.stepSimulation()

            # Check for contact
            contacts = p.getContactPoints(object_body, membrane_body)
            if contacts:
                # Accumulate the last set of contacts
                contact_points_raw = contacts

        # Phase 2: Hold contact for stabilization
        for _ in range(120):  # 0.5s hold
            p.resetBaseVelocity(object_body, linearVelocity=[0, 0, 0])
            p.stepSimulation()
            contacts = p.getContactPoints(object_body, membrane_body)
            if contacts:
                contact_points_raw = contacts

        # Extract contact data
        contact_points = []
        max_penetration = 0.0

        for cp in contact_points_raw:
            position = np.array(cp[5])      # positionOnB (membrane surface)
            normal = np.array(cp[7])         # contactNormalOnB
            normal_force = cp[9]             # normalForce
            lat_friction1 = cp[10]           # lateralFriction1
            lat_friction2 = cp[12]           # lateralFriction2
            penetration = -cp[8]             # negative of contactDistance

            if penetration > max_penetration:
                max_penetration = penetration

            contact_points.append(ContactPoint(
                position=position,
                normal=normal,
                normal_force=abs(normal_force),
                lateral_friction_1=lat_friction1,
                lateral_friction_2=lat_friction2,
            ))

        # Get final object pose
        obj_pos, obj_orn = p.getBasePositionAndOrientation(object_body)
        obj_mat = np.eye(4)
        obj_mat[:3, :3] = np.array(p.getMatrixFromQuaternion(obj_orn)).reshape(3, 3)
        obj_mat[:3, 3] = obj_pos

        return SimulationResult(
            contact_points=contact_points,
            object_pose=obj_mat,
            penetration_depth=max_penetration,
            mesh_path=mesh_path,
        )

    finally:
        p.disconnect(physics_client)
