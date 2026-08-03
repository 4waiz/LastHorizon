import * as THREE from 'three';
import { Rng, TAU } from '../utils/MathUtils';

/**
 * Flocks of bird silhouettes on looping paths.
 *
 * Path position and heading are computed on the CPU — a few dozen matrices a
 * frame is nothing — while the wing flap happens in the vertex shader, driven
 * by a per-instance phase attribute. That keeps every bird in one draw call
 * while still letting each one beat its wings out of step with its neighbours.
 */

interface Flock {
  centre: THREE.Vector3;
  radiusX: number;
  radiusZ: number;
  speed: number;
  phase: number;
  bob: number;
  /** Flocks fade in and out so the sky isn't permanently busy. */
  dutyOffset: number;
  dutyLength: number;
}

const FLAP_CHUNK = /* glsl */ `
attribute float aWing;
attribute float aSpan;
attribute float aPhase;
uniform float uTime;
uniform float uFlap;
`;

const FLAP_BODY = /* glsl */ `
  if (abs(aWing) > 0.5) {
    float beat = sin(uTime * uFlap + aPhase * 6.2831);
    float lift = beat * aSpan * 0.72;
    transformed.y += lift;
    transformed.x *= 1.0 - abs(beat) * aSpan * 0.16;
  }
`;

/** Body diamond plus two wing triangles, tagged for the flap shader. */
function birdGeometry(): THREE.BufferGeometry {
  const pos: number[] = [];
  const wing: number[] = [];
  const span: number[] = [];

  const push = (x: number, y: number, z: number, w: number, s: number) => {
    pos.push(x, y, z);
    wing.push(w);
    span.push(s);
  };

  // body: slim diamond pointing +Z
  push(0, 0, 0.34, 0, 0);
  push(-0.05, 0, -0.10, 0, 0);
  push(0.05, 0, -0.10, 0, 0);
  push(0, 0, -0.10, 0, 0);
  push(-0.04, 0.01, -0.30, 0, 0);
  push(0.04, 0.01, -0.30, 0, 0);

  // wings: swept triangles either side
  for (const s of [-1, 1]) {
    push(0, 0, 0.10, 0, 0);
    push(s * 0.52, 0, -0.20, s, 1);
    push(s * 0.16, 0, -0.24, s, 0.34);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute('aWing', new THREE.Float32BufferAttribute(wing, 1));
  geo.setAttribute('aSpan', new THREE.Float32BufferAttribute(span, 1));
  geo.setIndex([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]);
  geo.computeVertexNormals();
  return geo;
}

export class Birds {
  readonly mesh: THREE.InstancedMesh;
  private flocks: Flock[] = [];
  private readonly material: THREE.MeshBasicMaterial;
  private readonly uniforms = {
    uTime: { value: 0 },
    uFlap: { value: 7.4 },
  };

  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly p = new THREE.Vector3();
  private readonly s = new THREE.Vector3();
  private readonly e = new THREE.Euler();

  constructor(count: number) {
    const geo = birdGeometry();
    const rng = new Rng(5150);

    const phases = new Float32Array(count);
    for (let i = 0; i < count; i++) phases[i] = rng.next();
    geo.setAttribute('aPhase', new THREE.InstancedBufferAttribute(phases, 1));

    this.material = new THREE.MeshBasicMaterial({
      color: 0x2c3540,
      side: THREE.DoubleSide,
      fog: true,
      transparent: true,
      opacity: 0.92,
    });
    this.material.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = this.uniforms.uTime;
      shader.uniforms.uFlap = this.uniforms.uFlap;
      shader.vertexShader = FLAP_CHUNK + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' + FLAP_BODY,
      );
    };
    this.material.customProgramCacheKey = () => 'lh:bird';

    this.mesh = new THREE.InstancedMesh(geo, this.material, Math.max(1, count));
    this.mesh.name = 'Birds';
    this.mesh.frustumCulled = false;
    this.mesh.castShadow = false;
    this.mesh.receiveShadow = false;
    this.mesh.count = count;

    // Group the birds into a handful of loose flocks at different distances.
    const flockCount = Math.max(2, Math.round(count / 5));
    for (let i = 0; i < flockCount; i++) {
      this.flocks.push({
        centre: new THREE.Vector3(
          rng.range(-110, 110),
          rng.range(26, 74),
          rng.range(-120, 90),
        ),
        radiusX: rng.range(26, 88),
        radiusZ: rng.range(22, 76),
        speed: rng.range(0.055, 0.135),
        phase: rng.range(0, TAU),
        bob: rng.range(1.4, 5.0),
        dutyOffset: rng.range(0, 1),
        dutyLength: rng.range(0.45, 0.85),
      });
    }

    this.members = [];
    for (let i = 0; i < count; i++) {
      this.members.push({
        flock: this.flocks[i % this.flocks.length],
        offset: rng.range(0, 0.55),
        lateral: rng.range(-0.22, 0.22),
        vertical: rng.range(-7, 7),
        scale: rng.range(0.6, 1.5),
      });
    }
  }

  private members: Array<{
    flock: Flock;
    offset: number;
    lateral: number;
    vertical: number;
    scale: number;
  }>;

  update(dt: number, elapsed: number, cameraPos: THREE.Vector3): void {
    this.uniforms.uTime.value = elapsed;
    void dt;

    for (let i = 0; i < this.members.length; i++) {
      const mem = this.members[i];
      const f = mem.flock;
      const t = elapsed * f.speed + f.phase + mem.offset;

      // Duty cycle: each flock drifts far away for part of the loop so the
      // sky is never uniformly populated.
      const duty = (elapsed / 90 + f.dutyOffset) % 1;
      const away = duty > f.dutyLength ? 1 : 0;

      const rx = f.radiusX * (1 + mem.lateral);
      const rz = f.radiusZ * (1 + mem.lateral);
      const x = f.centre.x + Math.cos(t) * rx;
      const z = f.centre.z + Math.sin(t * 1.13) * rz;
      const y =
        f.centre.y + mem.vertical + Math.sin(t * 2.1 + mem.offset * 9) * f.bob + away * 130;

      // Heading from the analytic tangent of the path.
      const dx = -Math.sin(t) * rx;
      const dz = Math.cos(t * 1.13) * rz * 1.13;
      const yaw = Math.atan2(dx, dz);
      const bank = Math.max(-0.5, Math.min(0.5, -Math.sin(t) * 0.34));

      this.p.set(x, y, z);
      this.e.set(0, yaw, bank);
      this.q.setFromEuler(this.e);

      // Distant birds are scaled up slightly so they stay readable specks.
      const dist = this.p.distanceTo(cameraPos);
      const sc = mem.scale * (1 + Math.min(dist / 220, 1.1));
      this.s.setScalar(sc);

      this.m.compose(this.p, this.q, this.s);
      this.mesh.setMatrixAt(i, this.m);
    }
    this.mesh.instanceMatrix.needsUpdate = true;
  }

  setCount(count: number): void {
    this.mesh.count = Math.min(count, this.mesh.instanceMatrix.count);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.mesh.dispose();
  }
}
