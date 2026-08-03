import * as THREE from 'three';
import { Rng, clamp, lerp, smoothstep } from '../utils/MathUtils';
import { makeToon } from '../graphics/ToonMaterial';

/**
 * Spline-driven road network.
 *
 * Two curves — a long main road climbing toward the hill and one side road —
 * are sampled into a polyline, then rasterised into a coarse *road field*:
 * a grid holding, per cell, the distance to the nearest carriageway point and
 * that point's elevation. The terrain reads that field to flatten its
 * corridor, placement code reads it to keep props off the tarmac, and the
 * footstep audio reads it to pick a surface. One structure, four consumers,
 * and no per-frame closest-point-on-spline searches.
 */

export const ROAD_HALF_WIDTH = 4.7;
export const SHOULDER_WIDTH = 1.9;
/** Distance over which terrain blends from road level back to natural. */
export const ROAD_BLEND = 13.0;

/** How far the terrain corridor is cut below the graded centreline. */
export const ROAD_CUT = 0.012;

/**
 * Ribbon heights above the *finished terrain*, not above the centreline.
 *
 * The ribbons are strips with no sides, so anything between them and the
 * ground is a void you see straight through at a grazing angle and the deck
 * reads as floating — which it did, at a uniform 7 cm. Keep these in the low
 * millimetres: enough to clear the terrain grid's interpolation, not enough to
 * cast a visible lip.
 */
export const ASPHALT_LIFT = 0.02;
/** Shoulder, a touch under the carriageway it tucks beneath. */
export const SHOULDER_LIFT = 0.014;
/** Painted markings, clear of the asphalt and offset in depth as well. */
export const PAINT_LIFT = 0.032;

const FIELD_CELL = 1.0;
const FIELD_MAX = ROAD_HALF_WIDTH + SHOULDER_WIDTH + ROAD_BLEND + 6;

export interface RoadSample {
  /** Metres from the carriageway centreline. */
  dist: number;
  /** Road surface height at the nearest centreline point. */
  elevation: number;
}

interface Polyline {
  pts: THREE.Vector3[];
  tangents: THREE.Vector2[];
  halfWidth: number;
  /** Cumulative length at each point, for dash spacing. */
  lengths: number[];
}

function buildPolyline(
  controls: Array<[number, number]>,
  steps: number,
  halfWidth: number,
  heightFn: (x: number, z: number) => number,
): Polyline {
  const curve = new THREE.CatmullRomCurve3(
    controls.map(([x, z]) => new THREE.Vector3(x, 0, z)),
    false,
    'catmullrom',
    0.5,
  );
  const raw = curve.getSpacedPoints(steps);

  // Sample natural ground under the centreline, then smooth it hard: a road
  // follows a graded profile, it does not ripple with every noise octave.
  const ys = raw.map((p) => heightFn(p.x, p.z));
  const smoothed = ys.slice();
  const K = 9;
  for (let pass = 0; pass < 3; pass++) {
    for (let i = 0; i < ys.length; i++) {
      let acc = 0;
      let n = 0;
      for (let k = -K; k <= K; k++) {
        const j = clamp(i + k, 0, ys.length - 1);
        acc += smoothed[j];
        n++;
      }
      ys[i] = acc / n;
    }
    for (let i = 0; i < ys.length; i++) smoothed[i] = ys[i];
  }

  const pts = raw.map((p, i) => new THREE.Vector3(p.x, smoothed[i], p.z));
  const tangents: THREE.Vector2[] = [];
  const lengths: number[] = [0];
  for (let i = 0; i < pts.length; i++) {
    const a = pts[Math.max(0, i - 1)];
    const b = pts[Math.min(pts.length - 1, i + 1)];
    tangents.push(new THREE.Vector2(b.x - a.x, b.z - a.z).normalize());
    if (i > 0) {
      lengths.push(lengths[i - 1] + Math.hypot(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z));
    }
  }
  return { pts, tangents, halfWidth, lengths };
}

/**
 * Weld a subordinate line's profile onto the primary one near their crossing.
 *
 * Each line is graded independently, so where they meet their smoothed
 * profiles disagree — here by 15 cm. The road field takes whichever centreline
 * happens to be nearer, so that disagreement becomes a step in the tarmac and
 * a cliff in the terrain corridor the field flattens. Pulling the side road
 * onto the main one over a generous radius removes both at once, which is also
 * how a real junction is built: the minor road is graded to meet the major.
 */
function weldJunction(primary: Polyline, secondary: Polyline, radius: number): void {
  const targets = secondary.pts.map((p) => {
    let bestD = Infinity;
    let bestY = p.y;
    for (const q of primary.pts) {
      const d = Math.hypot(p.x - q.x, p.z - q.z);
      if (d < bestD) {
        bestD = d;
        bestY = q.y;
      }
    }
    return { d: bestD, y: bestY };
  });

  for (let i = 0; i < secondary.pts.length; i++) {
    const { d, y } = targets[i];
    if (d >= radius) continue;
    secondary.pts[i].y = lerp(y, secondary.pts[i].y, smoothstep(0, radius, d));
  }

  // Re-smooth so the graft doesn't leave a kink where the weight runs out.
  const ys = secondary.pts.map((p) => p.y);
  const K = 6;
  for (let pass = 0; pass < 2; pass++) {
    const src = ys.slice();
    for (let i = 0; i < ys.length; i++) {
      let acc = 0;
      for (let k = -K; k <= K; k++) acc += src[clamp(i + k, 0, ys.length - 1)];
      ys[i] = acc / (K * 2 + 1);
    }
  }
  // The weld itself must survive the smoothing, so re-apply it afterwards.
  for (let i = 0; i < secondary.pts.length; i++) {
    const { d, y } = targets[i];
    secondary.pts[i].y = d >= radius ? ys[i] : lerp(y, ys[i], smoothstep(0, radius, d));
  }
}

export class RoadNetwork {
  readonly main: Polyline;
  readonly side: Polyline;
  private readonly lines: Polyline[];

  private field!: Float32Array; // packed [dist, elevation] pairs
  private cols = 0;
  private rows = 0;

  constructor(
    private readonly size: number,
    heightFn: (x: number, z: number) => number,
  ) {
    this.main = buildPolyline(
      [
        [2, 168],
        [1, 120],
        [4, 74],
        [-4, 28],
        [0, -14],
        [8, -56],
        [5, -98],
        [1, -140],
        [2, -178],
      ],
      260,
      ROAD_HALF_WIDTH,
      heightFn,
    );
    this.side = buildPolyline(
      [
        [-1, 20],
        [16, 12],
        [40, 2],
        [62, -14],
        [78, -40],
        [86, -72],
      ],
      130,
      3.7,
      heightFn,
    );
    weldJunction(this.main, this.side, 34);
    this.lines = [this.main, this.side];
    this.rasterise();
  }

  /**
   * Splat each centreline into cells: nearest distance, blended elevation.
   *
   * Distance is a plain minimum, but elevation cannot be. Taking the nearest
   * line's height draws a Voronoi seam between the two roads, and across that
   * seam the height jumps by however much their grades differ — a fault line
   * through the middle of the junction that the terrain then flattens itself
   * onto. Each line gets its own pass, and the results are combined with an
   * inverse-square weight: away from the junction the near line outweighs the
   * far one thousands to one and nothing changes, while at the crossing the
   * two grades meet in a smooth saddle.
   */
  private rasterise(): void {
    const half = this.size / 2;
    this.cols = Math.ceil(this.size / FIELD_CELL) + 1;
    this.rows = this.cols;
    const cells = this.cols * this.rows;
    this.field = new Float32Array(cells * 2);

    const perLine = this.lines.map(() => {
      const f = new Float32Array(cells * 2);
      for (let i = 0; i < cells; i++) f[i * 2] = FIELD_MAX;
      return f;
    });

    const reach = Math.ceil(FIELD_MAX / FIELD_CELL);
    this.lines.forEach((line, li) => {
      const f = perLine[li];
      for (let s = 0; s < line.pts.length - 1; s++) {
        const a = line.pts[s];
        const b = line.pts[s + 1];
        const cx = Math.round((((a.x + b.x) / 2) + half) / FIELD_CELL);
        const cz = Math.round((((a.z + b.z) / 2) + half) / FIELD_CELL);
        for (let gz = cz - reach; gz <= cz + reach; gz++) {
          if (gz < 0 || gz >= this.rows) continue;
          for (let gx = cx - reach; gx <= cx + reach; gx++) {
            if (gx < 0 || gx >= this.cols) continue;
            const px = gx * FIELD_CELL - half;
            const pz = gz * FIELD_CELL - half;
            const abx = b.x - a.x;
            const abz = b.z - a.z;
            const l2 = abx * abx + abz * abz;
            const t = l2 < 1e-9 ? 0 : clamp(((px - a.x) * abx + (pz - a.z) * abz) / l2, 0, 1);
            const qx = a.x + abx * t;
            const qz = a.z + abz * t;
            const d = Math.hypot(px - qx, pz - qz);
            if (d >= FIELD_MAX) continue;
            const idx = (gz * this.cols + gx) * 2;
            if (d < f[idx]) {
              f[idx] = d;
              f[idx + 1] = lerp(a.y, b.y, t);
            }
          }
        }
      }
    });

    // lines[0] is the main road, and it owns the junction outright: a minor
    // road ends *at* the major one, so within a few metres of the main
    // carriageway the side road gets no say in the height at all. Without
    // that, its frozen endpoint elevation fights the main road's grade and
    // pulls the surface out from under the ribbon by several centimetres.
    for (let i = 0; i < cells; i++) {
      const dMain = perLine[0][i * 2];
      let best = FIELD_MAX;
      let sumW = 0;
      let sumWY = 0;
      for (let li = 0; li < perLine.length; li++) {
        const d = perLine[li][i * 2];
        if (d >= FIELD_MAX) continue;
        best = Math.min(best, d);
        const authority = li === 0 ? 1 : smoothstep(2, 12, dMain);
        if (authority <= 0) continue;
        // +0.4 keeps the weight finite right on a centreline.
        const w = authority / ((d + 0.4) * (d + 0.4));
        sumW += w;
        sumWY += w * perLine[li][i * 2 + 1];
      }
      this.field[i * 2] = best;
      this.field[i * 2 + 1] = sumW > 0 ? sumWY / sumW : 0;
    }
  }

  /** Bilinear lookup of the road field. */
  sample(x: number, z: number): RoadSample {
    const half = this.size / 2;
    const fx = clamp((x + half) / FIELD_CELL, 0, this.cols - 1.001);
    const fz = clamp((z + half) / FIELD_CELL, 0, this.rows - 1.001);
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;

    let dist = 0;
    let elev = 0;
    for (let j = 0; j <= 1; j++) {
      for (let i = 0; i <= 1; i++) {
        const w = (i ? tx : 1 - tx) * (j ? tz : 1 - tz);
        const idx = ((z0 + j) * this.cols + (x0 + i)) * 2;
        dist += this.field[idx] * w;
        elev += this.field[idx + 1] * w;
      }
    }
    return { dist, elevation: elev };
  }

  /** 1 on tarmac, fading to 0 across the shoulder. Used for footsteps. */
  surfaceHardness(x: number, z: number): number {
    const d = this.sample(x, z).dist;
    return 1 - smoothstep(ROAD_HALF_WIDTH - 0.4, ROAD_HALF_WIDTH + SHOULDER_WIDTH, d);
  }

  /** Point and heading a fraction along the main road, for spawn placement. */
  pointOnMain(t: number): { pos: THREE.Vector3; heading: number } {
    const i = clamp(Math.round(t * (this.main.pts.length - 1)), 0, this.main.pts.length - 1);
    const tan = this.main.tangents[i];
    return { pos: this.main.pts[i].clone(), heading: Math.atan2(tan.x, tan.y) };
  }
}

// --------------------------------------------------------------------------
// Geometry
// --------------------------------------------------------------------------

interface RibbonOpts {
  from: number;
  to: number;
  lift: number;
}

/** Lateral vertex spacing. Must stay finer than the terrain grid (~2.05 m). */
export const RIBBON_STEP = 0.95;

/**
 * Build a strip between two lateral offsets along a polyline.
 *
 * Height comes from the finished ground, not from the polyline. A ribbon that
 * carries its own y drifts away from the terrain wherever anything else has a
 * say in the ground — the junction blend, a building pad — and at the junction
 * that drift reached 13 cm, enough for the terrain to swallow the side road's
 * tarmac whole. Reading the ground and adding a few millimetres makes the two
 * agree by construction.
 *
 * The cross-section is tessellated as well. Two vertices spanning 9.4 m draw a
 * straight chord under a surface that curves, and the middle of that chord
 * sinks below the ground it is supposed to cover; stepping finer than the
 * terrain's own grid keeps the strip within a millimetre of it.
 */
function ribbon(
  groundAt: (x: number, z: number) => number,
  line: Polyline,
  o: RibbonOpts,
): THREE.BufferGeometry {
  const span = Math.abs(o.to - o.from);
  const cols = Math.max(2, Math.ceil(span / RIBBON_STEP) + 1);
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];

  for (let i = 0; i < line.pts.length; i++) {
    const p = line.pts[i];
    const t = line.tangents[i];
    const nx = -t.y;
    const nz = t.x;
    const v = line.lengths[i] * 0.12;
    for (let c = 0; c < cols; c++) {
      const f = c / (cols - 1);
      const off = lerp(o.from, o.to, f);
      const x = p.x + nx * off;
      const z = p.z + nz * off;
      pos.push(x, groundAt(x, z) + o.lift, z);
      uv.push(f, v);
    }
    if (i > 0) {
      const a = (i - 1) * cols;
      const b = i * cols;
      for (let c = 0; c < cols - 1; c++) {
        idx.push(a + c, a + c + 1, b + c, a + c + 1, b + c + 1, b + c);
      }
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A marking quad lying on the road at parameter index `i`, offset laterally. */
function roadQuad(
  groundAt: (x: number, z: number) => number,
  line: Polyline,
  i: number,
  lateral: number,
  width: number,
  length: number,
  lift: number,
): number[] {
  const p = line.pts[Math.min(i, line.pts.length - 1)];
  const t = line.tangents[Math.min(i, line.tangents.length - 1)];
  const nx = -t.y;
  const nz = t.x;
  const hw = width / 2;
  const hl = length / 2;
  const cx = p.x + nx * lateral;
  const cz = p.z + nz * lateral;
  const out: number[] = [];
  for (const [ox, oz] of [
    [-nx * hw - t.x * hl, -nz * hw - t.y * hl],
    [nx * hw - t.x * hl, nz * hw - t.y * hl],
    [nx * hw + t.x * hl, nz * hw + t.y * hl],
    [-nx * hw + t.x * hl, -nz * hw + t.y * hl],
  ]) {
    // Per-corner height, so a dash on a warped junction lies flat on it.
    out.push(cx + ox, groundAt(cx + ox, cz + oz) + lift, cz + oz);
  }
  return out;
}

function quadsToGeometry(quads: number[][]): THREE.BufferGeometry {
  const pos: number[] = [];
  const idx: number[] = [];
  quads.forEach((q, n) => {
    pos.push(...q);
    const b = n * 4;
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  });
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** Speckled asphalt, generated at runtime so no texture ships in the build. */
function asphaltTexture(): THREE.Texture {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = '#a9aca9';
  ctx.fillRect(0, 0, s, s);
  const rng = new Rng(90210);
  for (let i = 0; i < 5200; i++) {
    const v = rng.next();
    const shade = v < 0.55 ? 150 : v < 0.85 ? 178 : 196;
    ctx.fillStyle = `rgba(${shade},${shade + 2},${shade},${0.30 + rng.next() * 0.4})`;
    const r = rng.range(0.5, 1.9);
    ctx.beginPath();
    ctx.arc(rng.next() * s, rng.next() * s, r, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 90; i++) {
    ctx.fillStyle = `rgba(120,124,122,${0.05 + rng.next() * 0.07})`;
    ctx.fillRect(rng.next() * s, rng.next() * s, rng.range(6, 26), rng.range(6, 26));
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace; // authored in sRGB, must be declared
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export interface RoadBuild {
  group: THREE.Group;
  /** Low-poly surfaces worth feeding to the collision BVH (none — the
   *  terrain already covers the corridor; markings must never bump). */
  colliders: THREE.Mesh[];
}

export function buildRoadMeshes(
  net: RoadNetwork,
  groundAt: (x: number, z: number) => number,
): RoadBuild {
  const group = new THREE.Group();
  group.name = 'Roads';

  const asphaltMat = makeToon(0xffffff, { id: 'asphalt', map: asphaltTexture() });

  const shoulderMat = makeToon(0xcbb98f, { id: 'shoulder' });

  const paintMat = makeToon(0xf2ecdd, { id: 'roadpaint' });
  paintMat.polygonOffset = true;
  paintMat.polygonOffsetFactor = -3;
  paintMat.polygonOffsetUnits = -3;


  for (const [name, line] of [['Main', net.main], ['Side', net.side]] as const) {
    const hw = line.halfWidth;

    const road = new THREE.Mesh(
      ribbon(groundAt, line, { from: -hw, to: hw, lift: ASPHALT_LIFT }),
      asphaltMat,
    );
    road.name = `Asphalt${name}`;
    road.receiveShadow = true;
    group.add(road);

    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(
        ribbon(groundAt, line, {
          // Overlap the carriageway slightly. Butting the two strips edge to
          // edge at different heights leaves a hairline you can see through.
          from: s * (hw - 0.08),
          to: s * (hw + SHOULDER_WIDTH),
          lift: SHOULDER_LIFT,
        }),
        shoulderMat,
      );
      sh.name = `Shoulder${name}${s}`;
      sh.receiveShadow = true;
      group.add(sh);
    }

    // continuous edge lines
    for (const s of [-1, 1]) {
      const edge = new THREE.Mesh(
        ribbon(groundAt, line, { from: s * (hw - 0.62), to: s * (hw - 0.44), lift: PAINT_LIFT }),
        paintMat,
      );
      edge.name = `Edge${name}${s}`;
      group.add(edge);
    }

    // dashed centre line
    const dashes: number[][] = [];
    const total = line.lengths[line.lengths.length - 1];
    const period = 8.0;
    for (let d = 6; d < total - 6; d += period) {
      let i = 0;
      while (i < line.lengths.length - 1 && line.lengths[i] < d) i++;
      dashes.push(roadQuad(groundAt, line, i, 0, 0.17, 3.4, PAINT_LIFT));
    }
    const dash = new THREE.Mesh(quadsToGeometry(dashes), paintMat);
    dash.name = `Dashes${name}`;
    group.add(dash);

  }

  // Crosswalks: fat bars across the main road at two spots.
  const bars: number[][] = [];
  for (const at of [0.545, 0.30]) {
    const i = Math.round(at * (net.main.pts.length - 1));
    for (let b = -3; b <= 3; b++) {
      bars.push(roadQuad(groundAt, net.main, i, b * 1.24, 0.78, 6.2, PAINT_LIFT));
    }
  }
  const zebra = new THREE.Mesh(quadsToGeometry(bars), paintMat);
  zebra.name = 'Crosswalks';
  group.add(zebra);

  return { group, colliders: [] };
}
