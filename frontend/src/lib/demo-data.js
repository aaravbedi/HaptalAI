/**
 * Pre-baked simulation result for a 10mm sphere (poke scenario, GelSight).
 * Used for demo mode when no backend is available (e.g. GitHub Pages).
 */
export const DEMO_SIM_DATA = {
  contacts: [
    {
      position: [0, 0, 0.00129],
      normal: [0, 0, 1],
      normal_force: 0.981,
    },
  ],
  curvature_radius: 0.01,
  penetration_depth: 0.000206,
  sensor_specs: {
    resolution: 64,
    sensing_area: 0.02,
    gel_young_modulus: 500000.0,
    gel_poisson_ratio: 0.48,
    noise_std: 5.0,
    spatial_blur_sigma: 0.8,
  },
  E_star: 649688.15,
  total_sim_force: 0.981,
  mesh_file: "sphere_10mm.obj (demo)",
};
