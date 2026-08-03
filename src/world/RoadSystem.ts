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
    this.lines = [this.main, this.side];
    this.rasterise();
  }

  /** Splat each centreline sample into nearby cells, keeping the minimum. */
  private rasterise(): void {
    const half = this.size / 2;
    this.cols = Math.ceil(this.size / FIELD_CELL) + 1;
    this.rows = this.cols;
    this.field = new Float32Array(this.cols * this.rows * 2);
    for (let i = 0; i < this.cols * this.rows; i++) {
      this.field[i * 2] = FIELD_MAX;
      this.field[i * 2 + 1] = 0;
    }

    const reach = Math.ceil(FIELD_MAX / FIELD_CELL);
    for (const line of this.lines) {
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
            if (d < this.field[idx]) {
              this.field[idx] = d;
              this.field[idx + 1] = lerp(a.y, b.y, t);
            }
          }
        }
      }
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

/** Build a triangle strip between two lateral offsets along a polyline. */
function ribbon(line: Polyline, o: RibbonOpts, range?: [number, number]): THREE.BufferGeometry {
  const i0 = range ? range[0] : 0;
  const i1 = range ? range[1] : line.pts.length - 1;
  const pos: number[] = [];
  const idx: number[] = [];
  const uv: number[] = [];
  let row = 0;
  for (let i = i0; i <= i1; i++) {
    const p = line.pts[i];
    const t = line.tangents[i];
    const nx = -t.y;
    const nz = t.x;
    pos.push(p.x + nx * o.from, p.y + o.lift, p.z + nz * o.from);
    pos.push(p.x + nx * o.to, p.y + o.lift, p.z + nz * o.to);
    const v = line.lengths[i] * 0.12;
    uv.push(0, v, 1, v);
    if (row > 0) {
      const b = (row - 1) * 2;
      idx.push(b, b + 1, b + 2, b + 1, b + 3, b + 2);
    }
    row++;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/** A flat quad lying on the road at parameter index `i`, offset laterally. */
function roadQuad(
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
  const y = p.y + lift;
  return [
    cx - nx * hw - t.x * hl, y, cz - nz * hw - t.y * hl,
    cx + nx * hw - t.x * hl, y, cz + nz * hw - t.y * hl,
    cx + nx * hw + t.x * hl, y, cz + nz * hw + t.y * hl,
    cx - nx * hw + t.x * hl, y, cz - nz * hw + t.y * hl,
  ];
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
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.repeat.set(1, 1);
  tex.anisotropy = 4;
  return tex;
}

/** Branching hairline cracks, drawn as thin dark ribbons on the surface. */
function crackGeometry(line: Polyline, rng: Rng, count: number): THREE.BufferGeometry {
  const quads: number[][] = [];
  const n = line.pts.length;

  const walk = (startI: number, lateral: number, steps: number, width: number, depth: number) => {
    let i = startI;
    let lat = lateral;
    let dir = rng.next() < 0.5 ? 1 : -1;
    for (let s = 0; s < steps && i > 1 && i < n - 2; s++) {
      const di = Math.round(rng.range(1, 3));
      const dl = rng.range(0.25, 1.1) * dir;
      const nextI = i + di;
      const nextLat = clamp(lat + dl, -ROAD_HALF_WIDTH + 0.3, ROAD_HALF_WIDTH - 0.3);

      const a = line.pts[i];
      const ta = line.tangents[i];
      const b = line.pts[Math.min(n - 1, nextI)];
      const tb = line.tangents[Math.min(n - 1, nextI)];
      const ax = a.x + -ta.y * lat;
      const az = a.z + ta.x * lat;
      const bx = b.x + -tb.y * nextLat;
      const bz = b.z + tb.x * nextLat;
      const dx = bx - ax;
      const dz = bz - az;
      const len = Math.hypot(dx, dz) || 1;
      const px = (-dz / len) * width * 0.5;
      const pz = (dx / len) * width * 0.5;
      quads.push([
        ax - px, a.y + 0.012, az - pz,
        ax + px, a.y + 0.012, az + pz,
        bx + px, b.y + 0.012, bz + pz,
        bx - px, b.y + 0.012, bz - pz,
      ]);

      i = nextI;
      lat = nextLat;
      if (rng.next() < 0.22) dir *= -1;
      if (depth > 0 && rng.next() < 0.16) {
        walk(i, lat, Math.round(steps * 0.4), width * 0.65, depth - 1);
      }
    }
  };

  for (let c = 0; c < count; c++) {
    walk(
      Math.round(rng.range(6, n - 20)),
      rng.range(-ROAD_HALF_WIDTH + 0.6, ROAD_HALF_WIDTH - 0.6),
      Math.round(rng.range(5, 16)),
      rng.range(0.05, 0.13),
      2,
    );
  }
  return quadsToGeometry(quads);
}

export interface RoadBuild {
  group: THREE.Group;
  /** Low-poly surfaces worth feeding to the collision BVH (none — the
   *  terrain already covers the corridor; markings must never bump). */
  colliders: THREE.Mesh[];
}

export function buildRoadMeshes(net: RoadNetwork): RoadBuild {
  const group = new THREE.Group();
  group.name = 'Roads';

  const asphaltMat = makeToon(0xffffff, {});
  asphaltMat.map = asphaltTexture();
  asphaltMat.needsUpdate = true;

  const shoulderMat = makeToon(0xcbb98f);
  const paintMat = makeToon(0xf2ecdd);
  paintMat.polygonOffset = true;
  paintMat.polygonOffsetFactor = -3;
  paintMat.polygonOffsetUnits = -3;
  const crackMat = makeToon(0x6f7370, { transparent: true, opacity: 0.55 });
  crackMat.polygonOffset = true;
  crackMat.polygonOffsetFactor = -2;
  crackMat.polygonOffsetUnits = -2;

  const rng = new Rng(4242);

  for (const [name, line] of [['Main', net.main], ['Side', net.side]] as const) {
    const hw = line.halfWidth;

    const road = new THREE.Mesh(ribbon(line, { from: -hw, to: hw, lift: 0.02 }), asphaltMat);
    road.name = `Asphalt${name}`;
    road.receiveShadow = true;
    group.add(road);

    for (const s of [-1, 1]) {
      const sh = new THREE.Mesh(
        ribbon(line, {
          from: s * hw,
          to: s * (hw + SHOULDER_WIDTH),
          lift: 0.012,
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
        ribbon(line, { from: s * (hw - 0.62), to: s * (hw - 0.44), lift: 0.032 }),
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
      dashes.push(roadQuad(line, i, 0, 0.17, 3.4, 0.032));
    }
    const dash = new THREE.Mesh(quadsToGeometry(dashes), paintMat);
    dash.name = `Dashes${name}`;
    group.add(dash);

    const cracks = new THREE.Mesh(crackGeometry(line, rng, name === 'Main' ? 22 : 9), crackMat);
    cracks.name = `Cracks${name}`;
    group.add(cracks);
  }

  // Crosswalks: fat bars across the main road at two spots.
  const bars: number[][] = [];
  for (const at of [0.545, 0.30]) {
    const i = Math.round(at * (net.main.pts.length - 1));
    for (let b = -3; b <= 3; b++) {
      bars.push(roadQuad(net.main, i, b * 1.24, 0.78, 6.2, 0.034));
    }
  }
  const zebra = new THREE.Mesh(quadsToGeometry(bars), paintMat);
  zebra.name = 'Crosswalks';
  group.add(zebra);

  return { group, colliders: [] };
}
