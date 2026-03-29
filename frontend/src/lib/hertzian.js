/**
 * Client-side Hertzian contact pressure computation.
 * Mirrors backend/app/sensor_model.py for live preview.
 *
 * Produces meaningfully different pressure maps depending on:
 *   - Sensor type: GelSight (softer gel, larger area) vs DIGIT (firmer, smaller)
 *   - Scenario:    grasp (symmetric) / poke (concentrated) / slide (asymmetric)
 */

/* ── Sensor-specific physical parameters ──────────────────────────── */
const SENSOR_PARAMS = {
  gelsight: {
    resolution: 64,
    sensing_area: 0.02,        // 20 mm
    E_gel: 0.5e6,              // 0.5 MPa
    poisson: 0.48,
    noise_std: 5.0,            // Pa
    blurPasses: 3,             // more blur → smoother gradient
    asymmetryScale: 0,         // perfectly symmetric sensor
  },
  digit: {
    resolution: 64,            // native 32x32 upsampled
    sensing_area: 0.015,       // 15 mm
    E_gel: 0.3e6,              // 0.3 MPa (softer gel)
    poisson: 0.48,
    noise_std: 8.0,
    blurPasses: 1,             // fewer blur → sharper edges
    asymmetryScale: 0.06,      // slight intrinsic asymmetry (oval-ish pad)
  },
};

/**
 * Compute effective Young's modulus for gel-rigid contact.
 * E* = E_gel / (1 - v^2)
 */
export function effectiveModulus(E_gel, poisson) {
  return E_gel / (1.0 - poisson * poisson);
}

/**
 * Compute Hertzian contact parameters.
 * Returns { contactRadius, peakPressure } in SI units.
 */
export function hertzianParams(force, radius, E_star) {
  if (force <= 0 || radius <= 0) return { contactRadius: 0, peakPressure: 0 };
  const a = Math.cbrt((3.0 * force * radius) / (4.0 * E_star));
  const p0 = Math.cbrt((6.0 * force * E_star * E_star) / (Math.PI ** 3 * radius * radius));
  return { contactRadius: a, peakPressure: p0 };
}

/**
 * Detect flat-face contact (many points, negligible z variation).
 */
function isFlatContact(contacts) {
  if (contacts.length < 4) return false;
  const zVals = contacts.map(c => c.position[2]);
  const zRange = Math.max(...zVals) - Math.min(...zVals);
  const xVals = contacts.map(c => c.position[0]);
  const yVals = contacts.map(c => c.position[1]);
  const xySpread = Math.max(
    Math.max(...xVals) - Math.min(...xVals),
    Math.max(...yVals) - Math.min(...yVals)
  );
  return zRange < 1e-4 && xySpread > 0.001;
}

/**
 * Compute a 64x64 pressure map from contact data + user-controlled force.
 *
 * @param {Object}  simData    - From /simulate endpoint (or DEMO_SIM_DATA)
 * @param {number}  forceN     - User-selected force (N)
 * @param {string}  sensorType - 'gelsight' | 'digit'
 * @param {string}  scenario   - 'grasp' | 'poke' | 'slide'
 * @returns {{ map: Float64Array, maxPressure: number, contactArea: number, integratedForce: number }}
 */
export function computePressureMap(simData, forceN, sensorType = 'gelsight', scenario = 'grasp') {
  /* ── Sensor-aware parameters ─────────────────────────────────── */
  const sp = SENSOR_PARAMS[sensorType] || SENSOR_PARAMS.gelsight;
  const res = sp.resolution;
  const area = sp.sensing_area;
  const E_star = effectiveModulus(sp.E_gel, sp.poisson);
  const R = simData.curvature_radius;

  const taxelSize = area / res;
  const halfArea = area / 2;

  // Scale factor: user force vs simulation force
  const simForce = simData.total_sim_force || 1.0;
  const scale = forceN / simForce;

  const map = new Float64Array(res * res);

  const contacts = simData.contacts;
  if (!contacts || contacts.length === 0) {
    return { map, maxPressure: 0, contactArea: 0, integratedForce: 0 };
  }

  /* ── Scenario modifiers ──────────────────────────────────────── */
  // contactRadiusFactor: multiplied into effective curvature radius
  //   smaller → smaller contact patch → higher peak pressure
  // shearShiftX: post-hoc asymmetric shift in +x (meters) for slide
  // shearPressureBias: linear ramp multiplied across x for slide
  let contactRadiusFactor = 1.0;
  let shearShiftX = 0.0;
  let shearPressureBias = 0.0;

  if (scenario === 'poke') {
    // Point contact: use 0.3x effective radius → much smaller a, higher p0
    contactRadiusFactor = 0.3;
  } else if (scenario === 'slide') {
    // Sliding: moderate contact + asymmetric smear in +x direction
    contactRadiusFactor = 0.7;
    shearShiftX = area * 0.08;          // shift contact center 8% of area in +x
    shearPressureBias = 0.40;           // 40% linear ramp across contact
  }
  // grasp: defaults (factor=1, no shear) — symmetric Hertzian

  const R_effective = R * contactRadiusFactor;

  const flat = isFlatContact(contacts);

  if (flat) {
    // Uniform pressure for flat contact
    const xs = contacts.map(c => c.position[0]);
    const ys = contacts.map(c => c.position[1]);
    let xMin = Math.min(...xs), xMax = Math.max(...xs);
    let yMin = Math.min(...ys), yMax = Math.max(...ys);
    // Expand by half spacing
    if (contacts.length > 1) {
      const xSorted = [...new Set(xs)].sort((a, b) => a - b);
      const ySorted = [...new Set(ys)].sort((a, b) => a - b);
      const dx = xSorted.length > 1 ? (xSorted[1] - xSorted[0]) / 2 : taxelSize;
      const dy = ySorted.length > 1 ? (ySorted[1] - ySorted[0]) / 2 : taxelSize;
      xMin -= dx; xMax += dx; yMin -= dy; yMax += dy;
    }
    let maskCount = 0;
    for (let row = 0; row < res; row++) {
      const y = -halfArea + (row + 0.5) * taxelSize;
      for (let col = 0; col < res; col++) {
        const x = -halfArea + (col + 0.5) * taxelSize;
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) maskCount++;
      }
    }
    const contactAreaM2 = maskCount * taxelSize * taxelSize;
    const p = contactAreaM2 > 0 ? (forceN / contactAreaM2) : 0;
    for (let row = 0; row < res; row++) {
      const y = -halfArea + (row + 0.5) * taxelSize;
      for (let col = 0; col < res; col++) {
        const x = -halfArea + (col + 0.5) * taxelSize;
        if (x >= xMin && x <= xMax && y >= yMin && y <= yMax) {
          map[row * res + col] = p;
        }
      }
    }
  } else {
    // Hertzian contact for each contact point
    for (const cp of contacts) {
      const f = cp.normal_force * scale;
      if (f < 1e-6) continue;

      const { contactRadius: a, peakPressure: p0 } = hertzianParams(f, R_effective, E_star);
      // Shift contact center in +x for slide scenario
      const cx = cp.position[0] + shearShiftX;
      const cy = cp.position[1];

      for (let row = 0; row < res; row++) {
        const y = -halfArea + (row + 0.5) * taxelSize;
        const dy = y - cy;
        for (let col = 0; col < res; col++) {
          const x = -halfArea + (col + 0.5) * taxelSize;
          const dx = x - cx;

          // DIGIT slight asymmetry: stretch y-axis by asymmetryScale
          const effDy = dy * (1.0 + sp.asymmetryScale);
          const r = Math.sqrt(dx * dx + effDy * effDy);

          if (r <= a) {
            const ratio = r / a;
            let pressure = p0 * Math.sqrt(1.0 - ratio * ratio);

            // Slide scenario: linear ramp — leading edge (+x) gets more pressure
            if (shearPressureBias > 0 && a > 0) {
              // dx/a ranges from -1..+1 within the contact circle
              // bias maps that to (1 - bias) .. (1 + bias)
              const ramp = 1.0 + shearPressureBias * (dx / a);
              pressure *= ramp;
            }

            map[row * res + col] += Math.max(0, pressure);
          }
        }
      }
    }
  }

  // Gaussian blur — sensor-dependent number of passes
  const blurred = boxBlur(map, res, sp.blurPasses);

  // Compute stats
  let maxP = 0, totalP = 0, contactCount = 0;
  const noiseThresh = sp.noise_std * 3;
  for (let i = 0; i < blurred.length; i++) {
    if (blurred[i] > maxP) maxP = blurred[i];
    totalP += blurred[i];
    if (blurred[i] > noiseThresh) contactCount++;
  }

  return {
    map: blurred,
    maxPressure: maxP,
    contactArea: contactCount * taxelSize * taxelSize * 1e6, // mm²
    integratedForce: totalP * taxelSize * taxelSize,
  };
}

/** Simple box blur for Float64Array grid. */
function boxBlur(src, size, passes) {
  let a = new Float64Array(src);
  let b = new Float64Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        let sum = 0, count = 0;
        for (let dr = -1; dr <= 1; dr++) {
          for (let dc = -1; dc <= 1; dc++) {
            const r2 = row + dr, c2 = col + dc;
            if (r2 >= 0 && r2 < size && c2 >= 0 && c2 < size) {
              sum += a[r2 * size + c2];
              count++;
            }
          }
        }
        b[row * size + col] = sum / count;
      }
    }
    [a, b] = [b, a];
  }
  return a;
}
