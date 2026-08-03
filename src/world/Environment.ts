import * as THREE from 'three';
import { Sky, SkyParams } from './Sky';
import { setLampGlow } from '../graphics/ToonMaterial';
import { QualityPreset, TimeMode } from '../core/Settings';
import { clamp, lerp, saturate, smoothstep } from '../utils/MathUtils';

/**
 * Lighting, atmosphere and the day/night cycle.
 *
 * Time runs 0..1 over a full day (0.5 = noon). Every visual consequence —
 * sun angle and colour, ambient fill, fog, sky gradient, cloud tint, street
 * lamp glow — is derived from that single scalar, so there is exactly one
 * place to reason about "what does dusk look like".
 */

/** Real seconds for one in-game day when the cycle is running. */
export const DAY_LENGTH_SECONDS = 300;

/** Haze starts this far out. Closer than this and the hills vanish. */
const FOG_NEAR = 130;

interface Keyframe {
  t: number;
  zenith: number;
  horizon: number;
  sun: number;
  sunIntensity: number;
  skyFill: number;
  groundFill: number;
  fillIntensity: number;
  fog: number;
  fogDensityScale: number;
  cloudLit: number;
  cloudShade: number;
}

/** Colour script for the day, sampled and blended by time of day. */
const SCRIPT: Keyframe[] = [
  {
    t: 0.0, // deep night
    zenith: 0x0a1226, horizon: 0x1b2742, sun: 0xb9c9ef,
    sunIntensity: 0.26, skyFill: 0x35496f, groundFill: 0x1b2029,
    fillIntensity: 0.60, fog: 0x1b2742, fogDensityScale: 1.22,
    cloudLit: 0x4a5670, cloudShade: 0x2a3247,
  },
  {
    t: 0.24, // first light
    zenith: 0x2f5488, horizon: 0xd79a6c, sun: 0xffb277,
    sunIntensity: 0.72, skyFill: 0x6f86ad, groundFill: 0x4a4238,
    fillIntensity: 0.62, fog: 0xd0a17c, fogDensityScale: 1.1,
    cloudLit: 0xf3cba6, cloudShade: 0x9c8ea0,
  },
  {
    t: 0.34, // morning
    zenith: 0x3d84d8, horizon: 0xe4eef0, sun: 0xfff5e0,
    sunIntensity: 2.55, skyFill: 0xb2d3f2, groundFill: 0xa9a189,
    fillIntensity: 0.72, fog: 0xdfeaee, fogDensityScale: 0.88,
    cloudLit: 0xfdf8ee, cloudShade: 0xd2dbe6,
  },
  {
    t: 0.5, // high afternoon — the reference frame
    zenith: 0x3a7fd6, horizon: 0xdfecf2, sun: 0xfff7e6,
    sunIntensity: 2.95, skyFill: 0xb6d6f4, groundFill: 0xaba38a,
    fillIntensity: 0.74, fog: 0xdeeaf0, fogDensityScale: 0.80,
    cloudLit: 0xfefaf1, cloudShade: 0xd4dde8,
  },
  {
    t: 0.68, // late afternoon
    zenith: 0x3d7fd0, horizon: 0xeee5d2, sun: 0xffefcc,
    sunIntensity: 2.70, skyFill: 0xb0cde8, groundFill: 0xa89a76,
    fillIntensity: 0.72, fog: 0xe6e4d6, fogDensityScale: 0.85,
    cloudLit: 0xfdf5e4, cloudShade: 0xd3ced2,
  },
  {
    t: 0.79, // golden hour
    zenith: 0x3c6ea8, horizon: 0xf0b073, sun: 0xff9d54,
    sunIntensity: 1.42, skyFill: 0x8fa4c4, groundFill: 0x7c6244,
    fillIntensity: 0.68, fog: 0xe6b189, fogDensityScale: 1.05,
    cloudLit: 0xffd3a4, cloudShade: 0xa78ea0,
  },
  {
    t: 0.86, // dusk
    zenith: 0x22406f, horizon: 0xb1735f, sun: 0xd6743c,
    sunIntensity: 0.52, skyFill: 0x5a6d95, groundFill: 0x3e3a38,
    fillIntensity: 0.52, fog: 0x9d7370, fogDensityScale: 1.16,
    cloudLit: 0xc09184, cloudShade: 0x6a637d,
  },
  {
    t: 1.0,
    zenith: 0x0a1226, horizon: 0x1b2742, sun: 0xb9c9ef,
    sunIntensity: 0.26, skyFill: 0x35496f, groundFill: 0x1b2029,
    fillIntensity: 0.60, fog: 0x1b2742, fogDensityScale: 1.22,
    cloudLit: 0x4a5670, cloudShade: 0x2a3247,
  },
];

/**
 * Mid-afternoon, not noon. A sun directly overhead flattens every facade and
 * kills the long raking shadows the whole look depends on.
 */
export const DEFAULT_TIME = 0.615;

const TIME_FOR_MODE: Record<Exclude<TimeMode, 'cycle'>, number> = {
  day: DEFAULT_TIME,
  dusk: 0.80,
  night: 0.03,
};

const _scratch = new THREE.Color();

function sampleColor(a: number, b: number, t: number, out: THREE.Color): THREE.Color {
  return out.setHex(a).lerp(_scratch.setHex(b), t);
}

export interface EnvironmentState {
  time: number;
  dayFactor: number;
  duskFactor: number;
  isNight: boolean;
  sunDirection: THREE.Vector3;
}

export class Environment {
  readonly group = new THREE.Group();
  readonly sun: THREE.DirectionalLight;
  readonly fill: THREE.HemisphereLight;
  readonly sky: Sky;

  /** 0..1, 0.5 = noon. */
  time = DEFAULT_TIME;
  private mode: TimeMode = 'cycle';

  readonly sunDirection = new THREE.Vector3(0.45, 0.72, 0.52);
  dayFactor = 1;
  duskFactor = 0;

  private fog: THREE.Fog;
  private shadowRadius: number;
  private readonly params: SkyParams = {
    sunDirection: new THREE.Vector3(),
    dayFactor: 1,
    duskFactor: 0,
    zenith: new THREE.Color(),
    horizon: new THREE.Color(),
    sunColor: new THREE.Color(),
    cloudLit: new THREE.Color(),
    cloudShade: new THREE.Color(),
  };
  private readonly tmpColor = new THREE.Color();
  private readonly shadowTarget = new THREE.Object3D();

  constructor(private scene: THREE.Scene, preset: QualityPreset) {
    this.group.name = 'Environment';
    this.shadowRadius = preset.shadowRadius;

    this.sun = new THREE.DirectionalLight(0xfff4dc, 2.45);
    this.sun.castShadow = preset.shadowsEnabled;
    this.configureShadow(preset);
    this.group.add(this.sun);
    this.group.add(this.shadowTarget);
    this.sun.target = this.shadowTarget;

    this.fill = new THREE.HemisphereLight(0xa8caea, 0x9a8f6d, 0.86);
    this.group.add(this.fill);

    this.sky = new Sky(preset.cloudCount);
    this.group.add(this.sky.group);

    this.fog = new THREE.Fog(0xd5e3e8, FOG_NEAR, preset.fogFar);
    scene.fog = this.fog;
    scene.add(this.group);

    this.applyTime(this.time);
  }

  private configureShadow(preset: QualityPreset): void {
    const s = this.sun.shadow;
    const r = preset.shadowRadius;
    s.mapSize.set(preset.shadowMapSize, preset.shadowMapSize);
    const cam = s.camera;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = r * 4.6;
    cam.updateProjectionMatrix();

    // Normal bias has to scale with the shadow texel, not sit at a fixed
    // number. At 3.5 cm texels a 3.5 cm offset is one texel — nowhere near
    // enough for a wall lit near its terminator, which is how the buildings
    // ended up wearing black bands of self-shadowing under their eaves. Eight
    // texels clears it, and at that size the character still keeps a contact
    // shadow at their feet.
    const texel = (r * 2) / preset.shadowMapSize;
    s.bias = -0.0005;
    s.normalBias = Math.max(0.12, texel * 8);

    // Shadows darken rather than erase. Zeroing the sun leaves a shaded face
    // lit by nothing but the hemisphere fill, which reads as flat black next
    // to a toon ramp whose darkest band is still more than half lit.
    s.intensity = 0.62;
    this.shadowRadius = r;
  }

  applyQuality(preset: QualityPreset): void {
    this.sun.castShadow = preset.shadowsEnabled;
    this.configureShadow(preset);
    this.sky.setCloudCount(preset.cloudCount);
    this.fog.far = preset.fogFar;
    this.applyTime(this.time);
  }

  /** Snap the clock, e.g. after sleeping. */
  jumpTo(t: number): void {
    this.applyTime(t);
  }

  setMode(mode: TimeMode): void {
    this.mode = mode;
    if (mode !== 'cycle') this.time = TIME_FOR_MODE[mode];
    this.applyTime(this.time);
  }

  get state(): EnvironmentState {
    return {
      time: this.time,
      dayFactor: this.dayFactor,
      duskFactor: this.duskFactor,
      isNight: this.dayFactor < 0.35,
      sunDirection: this.sunDirection,
    };
  }

  /** Human-readable clock, for the info panel. */
  get clockLabel(): string {
    const hours = (this.time * 24) % 24;
    const h = Math.floor(hours);
    const m = Math.floor((hours - h) * 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  private interpolate(t: number): Keyframe & { blendA: Keyframe; blendB: Keyframe; k: number } {
    let a = SCRIPT[0];
    let b = SCRIPT[SCRIPT.length - 1];
    for (let i = 0; i < SCRIPT.length - 1; i++) {
      if (t >= SCRIPT[i].t && t <= SCRIPT[i + 1].t) {
        a = SCRIPT[i];
        b = SCRIPT[i + 1];
        break;
      }
    }
    const k = a.t === b.t ? 0 : saturate((t - a.t) / (b.t - a.t));
    const s = smoothstep(0, 1, k);
    return {
      ...a,
      sunIntensity: lerp(a.sunIntensity, b.sunIntensity, s),
      fillIntensity: lerp(a.fillIntensity, b.fillIntensity, s),
      fogDensityScale: lerp(a.fogDensityScale, b.fogDensityScale, s),
      blendA: a,
      blendB: b,
      k: s,
    };
  }

  private applyTime(t: number): void {
    this.time = ((t % 1) + 1) % 1;
    const f = this.interpolate(this.time);
    const { blendA: a, blendB: b, k } = f;

    // Sun arc: rises in the east, sets in the west. The vertical component is
    // compressed so even "noon" sits around 50 degrees and facades keep a
    // clear lit side and shadow side.
    const angle = (this.time - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);
    const azimuth = Math.cos(angle);
    this.sunDirection
      .set(azimuth * 1.05, Math.max(elevation, -0.35) * 0.80, azimuth * 0.34 + 0.52)
      .normalize();

    this.dayFactor = saturate(smoothstep(-0.10, 0.16, elevation));
    this.duskFactor = clamp(1 - Math.abs(elevation) / 0.30, 0, 1);

    this.sun.position.copy(this.sunDirection).multiplyScalar(this.shadowRadius * 2.6);
    sampleColor(a.sun, b.sun, k, this.tmpColor);
    this.sun.color.copy(this.tmpColor);
    this.sun.intensity = f.sunIntensity;

    sampleColor(a.skyFill, b.skyFill, k, this.tmpColor);
    this.fill.color.copy(this.tmpColor);
    sampleColor(a.groundFill, b.groundFill, k, this.tmpColor);
    this.fill.groundColor.copy(this.tmpColor);
    this.fill.intensity = f.fillIntensity;

    sampleColor(a.fog, b.fog, k, this.tmpColor);
    this.fog.color.copy(this.tmpColor);
    this.fog.near = FOG_NEAR / f.fogDensityScale;

    sampleColor(a.zenith, b.zenith, k, this.params.zenith);
    sampleColor(a.horizon, b.horizon, k, this.params.horizon);
    sampleColor(a.sun, b.sun, k, this.params.sunColor);
    sampleColor(a.cloudLit, b.cloudLit, k, this.params.cloudLit);
    sampleColor(a.cloudShade, b.cloudShade, k, this.params.cloudShade);
    this.params.sunDirection.copy(this.sunDirection);
    this.params.dayFactor = this.dayFactor;
    this.params.duskFactor = this.duskFactor;
    this.sky.apply(this.params);

    // Street lamps warm up as the sun goes down.
    setLampGlow(1 - saturate(smoothstep(-0.02, 0.20, elevation)));
  }

  update(dt: number, elapsed: number, focus: THREE.Vector3, cameraPos: THREE.Vector3): void {
    if (this.mode === 'cycle') {
      this.applyTime(this.time + dt / DAY_LENGTH_SECONDS);
    }

    // Keep the shadow box centred slightly ahead of the player so the visible
    // frustum is covered without wasting resolution behind the camera.
    this.shadowTarget.position.set(focus.x, focus.y, focus.z);
    this.shadowTarget.updateMatrixWorld();
    this.sun.position
      .copy(this.sunDirection)
      .multiplyScalar(this.shadowRadius * 2.6)
      .add(this.shadowTarget.position);
    this.sun.updateMatrixWorld();

    this.sky.update(dt, elapsed, cameraPos);
  }

  /** Fraction of full darkness, used to gate the street lamp point lights. */
  get lampFactor(): number {
    return 1 - this.dayFactor;
  }

  dispose(): void {
    this.sky.dispose();
    this.scene.fog = null;
    this.group.removeFromParent();
  }
}
