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
    sunIntensity: 0.14, skyFill: 0x2a3a5e, groundFill: 0x14181f,
    fillIntensity: 0.42, fog: 0x1b2742, fogDensityScale: 1.22,
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
    zenith: 0x5691d2, horizon: 0xdfe7e4, sun: 0xfff0cf,
    sunIntensity: 2.05, skyFill: 0x9fc4e8, groundFill: 0x8e8264,
    fillIntensity: 0.80, fog: 0xd8e4e6, fogDensityScale: 1.0,
    cloudLit: 0xf9f2df, cloudShade: 0xc7cfda,
  },
  {
    t: 0.5, // high afternoon — the reference frame
    zenith: 0x4e8fd8, horizon: 0xd9e6ec, sun: 0xfff4dc,
    sunIntensity: 2.45, skyFill: 0xa8caea, groundFill: 0x9a8f6d,
    fillIntensity: 0.86, fog: 0xd5e3e8, fogDensityScale: 0.92,
    cloudLit: 0xf8f1de, cloudShade: 0xc6cedb,
  },
  {
    t: 0.68, // late afternoon
    zenith: 0x4f8bcd, horizon: 0xe8dcc4, sun: 0xffe6b4,
    sunIntensity: 2.15, skyFill: 0xa6c3e0, groundFill: 0x9c8a62,
    fillIntensity: 0.80, fog: 0xdfdccb, fogDensityScale: 0.96,
    cloudLit: 0xfaeed6, cloudShade: 0xc9c4c8,
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
    sunIntensity: 0.14, skyFill: 0x2a3a5e, groundFill: 0x14181f,
    fillIntensity: 0.42, fog: 0x1b2742, fogDensityScale: 1.22,
    cloudLit: 0x4a5670, cloudShade: 0x2a3247,
  },
];

const TIME_FOR_MODE: Record<Exclude<TimeMode, 'cycle'>, number> = {
  day: 0.5,
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
  time = 0.5;
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

    this.fog = new THREE.Fog(0xd5e3e8, 42, preset.fogFar);
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
    // Bias tuned against the 1.7 m terrain cells: enough to kill acne on the
    // road without detaching contact shadows from the character's feet.
    s.bias = -0.0006;
    s.normalBias = 0.035;
    this.shadowRadius = r;
  }

  applyQuality(preset: QualityPreset): void {
    this.sun.castShadow = preset.shadowsEnabled;
    this.configureShadow(preset);
    this.sky.setCloudCount(preset.cloudCount);
    this.fog.far = preset.fogFar;
    this.applyTime(this.time);
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
    const hours = (this.time * 24 + 12) % 24;
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

    // Sun arc: rises in the east, sets in the west, tilted so shadows rake
    // across the road the way they do in the reference frames.
    const angle = (this.time - 0.25) * Math.PI * 2;
    const elevation = Math.sin(angle);
    const azimuth = Math.cos(angle);
    this.sunDirection
      .set(azimuth * 0.86, Math.max(elevation, -0.35), azimuth * 0.30 + 0.46)
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
    this.fog.near = 40 / f.fogDensityScale;

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
