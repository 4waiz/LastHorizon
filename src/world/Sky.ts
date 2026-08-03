import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Rng } from '../utils/MathUtils';

/**
 * Original stylized sky: a gradient dome with a sun disc, a horizon haze band
 * and a procedural star field, plus drifting low-poly cumulus.
 *
 * The clouds are merged icosahedron clusters shaded by a two-tone ramp rather
 * than lit spheres — that is what gives the flat, painted cream look instead
 * of shiny white balls.
 */

export interface SkyParams {
  sunDirection: THREE.Vector3;
  /** 1 full day, 0 full night. */
  dayFactor: number;
  /** Peaks at 1 through sunrise/sunset. */
  duskFactor: number;
  zenith: THREE.Color;
  horizon: THREE.Color;
  sunColor: THREE.Color;
  cloudLit: THREE.Color;
  cloudShade: THREE.Color;
}

const SKY_VERT = /* glsl */ `
varying vec3 vDir;
void main() {
  vDir = position;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mv;
  gl_Position.z = gl_Position.w; // keep the dome pinned at the far plane
}
`;

const SKY_FRAG = /* glsl */ `
precision highp float;
varying vec3 vDir;

uniform vec3  uZenith;
uniform vec3  uHorizon;
uniform vec3  uSunColor;
uniform vec3  uSunDir;
uniform float uDay;
uniform float uDusk;
uniform float uTime;

float hash21(vec2 p) {
  p = fract(p * vec2(233.34, 851.73));
  p += dot(p, p + 23.45);
  return fract(p.x * p.y);
}

void main() {
  vec3 dir = normalize(vDir);
  float h = clamp(dir.y, -1.0, 1.0);

  // vertical gradient, weighted so most of the sky reads as the zenith tone
  float t = pow(clamp(h, 0.0, 1.0), 0.42);
  vec3 col = mix(uHorizon, uZenith, t);

  // warm band hugging the horizon, strongest at dusk
  float band = smoothstep(0.30, -0.06, h);
  col = mix(col, uHorizon, band * (0.35 + 0.45 * uDusk));

  float sd = max(dot(dir, normalize(uSunDir)), 0.0);

  // stars, revealed as the sun sets and fading out near the horizon haze
  float night = 1.0 - uDay;
  if (night > 0.01) {
    vec2 sp = vec2(atan(dir.z, dir.x) * 1.9, asin(h) * 3.4);
    vec2 cell = floor(sp * 78.0);
    float r = hash21(cell);
    float bright = smoothstep(0.9955, 0.9995, r);
    float twinkle = 0.62 + 0.38 * sin(uTime * 2.1 + r * 40.0);
    col += vec3(0.86, 0.90, 1.0) * bright * twinkle * night
         * smoothstep(0.02, 0.34, h);
  }

  // broad glow then a tight disc
  col += uSunColor * pow(sd, 7.0) * (0.30 + 0.85 * uDusk);
  col += uSunColor * pow(sd, 260.0) * 1.4;
  col += uSunColor * smoothstep(0.99965, 0.99992, sd) * 2.2;

  gl_FragColor = vec4(col, 1.0);
  #include <colorspace_fragment>
}
`;

const CLOUD_VERT = /* glsl */ `
varying vec3 vN;
varying float vH;
void main() {
  vN = normalize(normalMatrix * normal);
  vH = position.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const CLOUD_FRAG = /* glsl */ `
precision highp float;
varying vec3 vN;
varying float vH;
uniform vec3 uLit;
uniform vec3 uShade;
uniform vec3 uSunDir;
uniform float uOpacity;

void main() {
  vec3 n = normalize(vN);
  // Soft-edged bands. Hard steps turn a faceted cumulus into shattered
  // glass; easing the boundaries keeps the painted, poster-like read.
  float up = clamp(n.y * 0.62 + dot(n, normalize(uSunDir)) * 0.50 + 0.34, 0.0, 1.0);
  float band = smoothstep(0.22, 0.44, up) * 0.5 + smoothstep(0.52, 0.78, up) * 0.5;
  vec3 col = mix(uShade, uLit, 0.32 + band * 0.68);
  col = mix(col, uLit, clamp(vH * 0.035, 0.0, 0.28));
  gl_FragColor = vec4(col, uOpacity);
  #include <colorspace_fragment>
}
`;

interface CloudEntry {
  mesh: THREE.Mesh;
  speed: number;
  spin: number;
}

function cloudGeometry(rng: Rng): THREE.BufferGeometry {
  const parts: THREE.BufferGeometry[] = [];
  const lobes = rng.int(6, 10);
  const spread = rng.range(18, 32);
  for (let i = 0; i < lobes; i++) {
    const r = rng.range(8, 15);
    const g = new THREE.IcosahedronGeometry(r, 1);
    // Squash and jitter so no lobe reads as a sphere — but gently: heavy
    // per-vertex noise on a low subdivision reads as broken geometry.
    const pos = g.attributes.position as THREE.BufferAttribute;
    for (let v = 0; v < pos.count; v++) {
      pos.setXYZ(
        v,
        pos.getX(v) * rng.range(1.02, 1.22) + rng.jitter(r * 0.06),
        pos.getY(v) * rng.range(0.46, 0.60) + rng.jitter(r * 0.035),
        pos.getZ(v) * rng.range(0.94, 1.14) + rng.jitter(r * 0.055),
      );
    }
    g.translate(
      rng.jitter(spread),
      Math.max(0, rng.jitter(5)) - 1,
      rng.jitter(spread * 0.5),
    );
    parts.push(g);
  }
  const merged = mergeGeometries(parts, false)!;
  parts.forEach((p) => p.dispose());
  merged.computeVertexNormals();
  return merged;
}

export class Sky {
  readonly group = new THREE.Group();
  readonly dome: THREE.Mesh;
  readonly clouds = new THREE.Group();

  private skyMat: THREE.ShaderMaterial;
  private cloudMat: THREE.ShaderMaterial;
  private entries: CloudEntry[] = [];
  private wind = new THREE.Vector2(0.86, 0.51);
  private bounds = 760;

  constructor(cloudCount: number) {
    this.group.name = 'Sky';

    this.skyMat = new THREE.ShaderMaterial({
      vertexShader: SKY_VERT,
      fragmentShader: SKY_FRAG,
      side: THREE.BackSide,
      depthWrite: false,
      depthTest: true,
      fog: false,
      uniforms: {
        uZenith: { value: new THREE.Color(0x5c9ad8) },
        uHorizon: { value: new THREE.Color(0xd6e4ea) },
        uSunColor: { value: new THREE.Color(0xfff3d6) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5) },
        uDay: { value: 1 },
        uDusk: { value: 0 },
        uTime: { value: 0 },
      },
    });

    this.dome = new THREE.Mesh(new THREE.SphereGeometry(1, 32, 20), this.skyMat);
    this.dome.frustumCulled = false;
    this.dome.renderOrder = -1000;
    this.dome.matrixAutoUpdate = false;
    this.group.add(this.dome);

    this.cloudMat = new THREE.ShaderMaterial({
      vertexShader: CLOUD_VERT,
      fragmentShader: CLOUD_FRAG,
      transparent: false,
      depthWrite: true,
      fog: false,
      uniforms: {
        uLit: { value: new THREE.Color(0xf7efdb) },
        uShade: { value: new THREE.Color(0xc9cfd8) },
        uSunDir: { value: new THREE.Vector3(0.4, 0.7, 0.5) },
        uOpacity: { value: 0.97 },
      },
    });

    this.buildClouds(cloudCount);
    this.group.add(this.clouds);
  }

  private buildClouds(count: number): void {
    const rng = new Rng(20260803);
    for (let i = 0; i < count; i++) {
      const geo = cloudGeometry(rng);
      const mesh = new THREE.Mesh(geo, this.cloudMat);
      const angle = (i / count) * Math.PI * 2 + rng.jitter(0.5);
      const radius = rng.range(250, 570);
      mesh.position.set(
        Math.cos(angle) * radius,
        rng.range(104, 186),
        Math.sin(angle) * radius,
      );
      const s = rng.range(0.95, 1.95);
      mesh.scale.setScalar(s);
      mesh.rotation.y = rng.range(0, Math.PI * 2);
      mesh.renderOrder = -900;
      mesh.frustumCulled = true;
      this.clouds.add(mesh);
      this.entries.push({
        mesh,
        speed: rng.range(0.35, 0.95),
        spin: rng.jitter(0.006),
      });
    }
  }

  setCloudCount(count: number): void {
    if (count === this.entries.length) return;
    for (const e of this.entries) {
      e.mesh.geometry.dispose();
      this.clouds.remove(e.mesh);
    }
    this.entries = [];
    this.buildClouds(count);
  }

  apply(p: SkyParams): void {
    const u = this.skyMat.uniforms;
    (u.uZenith.value as THREE.Color).copy(p.zenith);
    (u.uHorizon.value as THREE.Color).copy(p.horizon);
    (u.uSunColor.value as THREE.Color).copy(p.sunColor);
    (u.uSunDir.value as THREE.Vector3).copy(p.sunDirection);
    u.uDay.value = p.dayFactor;
    u.uDusk.value = p.duskFactor;

    const c = this.cloudMat.uniforms;
    (c.uLit.value as THREE.Color).copy(p.cloudLit);
    (c.uShade.value as THREE.Color).copy(p.cloudShade);
    (c.uSunDir.value as THREE.Vector3).copy(p.sunDirection);
  }

  update(dt: number, elapsed: number, cameraPos: THREE.Vector3): void {
    this.skyMat.uniforms.uTime.value = elapsed;

    // Dome rides with the camera so it never clips the far plane.
    this.dome.position.copy(cameraPos);
    this.dome.scale.setScalar(1);
    this.dome.updateMatrix();

    for (const e of this.entries) {
      e.mesh.position.x += this.wind.x * e.speed * dt;
      e.mesh.position.z += this.wind.y * e.speed * dt;
      e.mesh.rotation.y += e.spin * dt;
      // wrap around the camera so the sky never empties out
      const dx = e.mesh.position.x - cameraPos.x;
      const dz = e.mesh.position.z - cameraPos.z;
      if (Math.hypot(dx, dz) > this.bounds) {
        e.mesh.position.x = cameraPos.x - dx * 0.94;
        e.mesh.position.z = cameraPos.z - dz * 0.94;
      }
    }
  }

  dispose(): void {
    this.dome.geometry.dispose();
    this.skyMat.dispose();
    for (const e of this.entries) e.mesh.geometry.dispose();
    this.cloudMat.dispose();
    this.entries = [];
  }
}
