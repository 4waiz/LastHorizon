import * as THREE from 'three';

/**
 * The one place materials are created.
 *
 * Everything in the world is a `MeshToonMaterial` sharing a single 3-band
 * gradient ramp, so the whole scene bands identically under the sun. Three
 * shader variants are patched in on top:
 *
 *   solid    plain toon surface
 *   foliage  world-phase wind sway, double sided
 *   grass    wind sway plus a bend away from the player
 *
 * Materials are cached by (colour, kind, flags) so a hundred imported meshes
 * collapse onto a handful of programs and draw calls batch cleanly.
 */

export type MaterialKind = 'solid' | 'foliage' | 'grass';

export interface ToonOptions {
  kind?: MaterialKind;
  /** Objects the camera may dither away when they block the player. */
  fadeable?: boolean;
  emissive?: THREE.ColorRepresentation;
  emissiveIntensity?: number;
  transparent?: boolean;
  opacity?: number;
  side?: THREE.Side;
  vertexColors?: boolean;
  map?: THREE.Texture;
  /**
   * Uniqueness token. Materials are shared by value, so two callers asking
   * for the same colour get the *same object* — mutating one then mutates
   * the other. Pass an id whenever the caller intends to configure the
   * material further.
   */
  id?: string;
  /* Note: MeshToonMaterial has no flatShading; the Blender kit bakes flat
     normals into the geometry instead. */
}

/** Uniforms shared by every patched material, updated once per frame. */
export const toonUniforms = {
  uTime: { value: 0 },
  uWindStrength: { value: 1 },
  uWindDir: { value: new THREE.Vector2(0.86, 0.51) },
  uPlayer: { value: new THREE.Vector3(0, -999, 0) },
  uPlayerRadius: { value: 1.15 },
};

let gradientMap: THREE.DataTexture | null = null;

/** Three broad bands: deep shadow, mid, full sun. */
export function getGradientMap(): THREE.DataTexture {
  if (gradientMap) return gradientMap;
  const steps = new Uint8Array([142, 208, 255]);
  const tex = new THREE.DataTexture(steps, steps.length, 1, THREE.RedFormat);
  tex.minFilter = THREE.NearestFilter;
  tex.magFilter = THREE.NearestFilter;
  tex.generateMipmaps = false;
  tex.needsUpdate = true;
  gradientMap = tex;
  return tex;
}

const BAYER = `
float lhBayer(vec2 c) {
  int x = int(mod(c.x, 4.0));
  int y = int(mod(c.y, 4.0));
  int i = x + y * 4;
  float t =
    i == 0  ? 0.0625 : i == 1  ? 0.5625 : i == 2  ? 0.1875 : i == 3  ? 0.6875 :
    i == 4  ? 0.8125 : i == 5  ? 0.3125 : i == 6  ? 0.9375 : i == 7  ? 0.4375 :
    i == 8  ? 0.2500 : i == 9  ? 0.7500 : i == 10 ? 0.1250 : i == 11 ? 0.6250 :
    i == 12 ? 1.0000 : i == 13 ? 0.5000 : i == 14 ? 0.8750 : 0.3750;
  return t;
}
`;

const WIND_HEAD = `
uniform float uTime;
uniform float uWindStrength;
uniform vec2  uWindDir;
uniform vec3  uPlayer;
uniform float uPlayerRadius;
`;

/**
 * Sway driven by world position so neighbouring instances of the same tree
 * are out of phase — otherwise a whole hillside breathes in unison.
 */
function windBody(kind: MaterialKind): string {
  const bendStrength = kind === 'grass' ? 0.34 : 0.16;
  const heightRef = kind === 'grass' ? 0.34 : 4.5;
  return /* glsl */ `
  vec4 lhWorld = modelMatrix * vec4(transformed, 1.0);
  #ifdef USE_INSTANCING
    lhWorld = modelMatrix * instanceMatrix * vec4(transformed, 1.0);
  #endif

  float lhH = clamp(position.y / ${heightRef.toFixed(2)}, 0.0, 1.6);
  float lhMask = lhH * lhH;
  float lhPhase = dot(lhWorld.xz, vec2(0.19, 0.23));
  float lhGust = 0.62 + 0.38 * sin(uTime * 0.31 + lhWorld.x * 0.021 + lhWorld.z * 0.017);
  float lhWave = sin(uTime * 1.55 + lhPhase) * 0.65
               + sin(uTime * 2.63 + lhPhase * 1.9) * 0.35;
  vec2 lhOff = uWindDir * (lhWave * lhGust * uWindStrength * ${bendStrength.toFixed(2)} * lhMask);
  transformed.x += lhOff.x;
  transformed.z += lhOff.y;
  transformed.y -= abs(lhOff.x) * 0.18;
  `;
}

const GRASS_PLAYER_BEND = /* glsl */ `
  vec2 lhToP = lhWorld.xz - uPlayer.xz;
  float lhD = length(lhToP);
  float lhNear = 1.0 - smoothstep(0.0, uPlayerRadius, lhD);
  float lhVert = 1.0 - smoothstep(0.0, 1.4, abs(lhWorld.y - uPlayer.y));
  float lhPush = lhNear * lhVert * lhMask;
  if (lhPush > 0.001) {
    vec2 lhDir = lhD > 0.0001 ? lhToP / lhD : vec2(1.0, 0.0);
    transformed.xz += lhDir * lhPush * 0.30;
    transformed.y  -= lhPush * 0.16;
  }
`;

const FADE_HEAD = `
uniform float uFade;
${BAYER}
`;

const FADE_BODY = /* glsl */ `
  if (uFade < 0.997) {
    if (uFade <= 0.002) discard;
    if (uFade < lhBayer(gl_FragCoord.xy)) discard;
  }
`;

export interface ToonMaterial extends THREE.MeshToonMaterial {
  /** 1 = fully visible, 0 = fully dithered out. Only on fadeable materials. */
  userData: { fade?: { value: number }; kind?: MaterialKind; lampKey?: string };
}

function patch(mat: THREE.MeshToonMaterial, kind: MaterialKind, fadeable: boolean): void {
  const fadeUniform = { value: 1 };
  (mat as ToonMaterial).userData.fade = fadeable ? fadeUniform : undefined;
  (mat as ToonMaterial).userData.kind = kind;

  mat.onBeforeCompile = (shader) => {
    if (kind !== 'solid') {
      shader.uniforms.uTime = toonUniforms.uTime;
      shader.uniforms.uWindStrength = toonUniforms.uWindStrength;
      shader.uniforms.uWindDir = toonUniforms.uWindDir;
      shader.uniforms.uPlayer = toonUniforms.uPlayer;
      shader.uniforms.uPlayerRadius = toonUniforms.uPlayerRadius;

      shader.vertexShader = WIND_HEAD + shader.vertexShader;
      shader.vertexShader = shader.vertexShader.replace(
        '#include <begin_vertex>',
        '#include <begin_vertex>\n' +
          windBody(kind) +
          (kind === 'grass' ? GRASS_PLAYER_BEND : ''),
      );
    }

    if (fadeable) {
      shader.uniforms.uFade = fadeUniform;
      shader.fragmentShader = FADE_HEAD + shader.fragmentShader;
      shader.fragmentShader = shader.fragmentShader.replace(
        '#include <clipping_planes_fragment>',
        '#include <clipping_planes_fragment>\n' + FADE_BODY,
      );
    }
  };

  // Without this every material instance compiles its own program.
  mat.customProgramCacheKey = () => `lh:${kind}:${fadeable ? 'f' : '-'}`;
}

const cache = new Map<string, ToonMaterial>();

export function makeToon(
  color: THREE.ColorRepresentation,
  opts: ToonOptions = {},
): ToonMaterial {
  const kind = opts.kind ?? 'solid';
  const fadeable = !!opts.fadeable;
  const col = new THREE.Color(color);
  const side = opts.side ?? (kind === 'solid' ? THREE.FrontSide : THREE.DoubleSide);
  const emissive = opts.emissive ? new THREE.Color(opts.emissive) : null;

  const key = [
    opts.id ?? '-',
    col.getHexString(),
    kind,
    fadeable ? 1 : 0,
    side,
    emissive ? emissive.getHexString() : '-',
    opts.emissiveIntensity ?? 1,
    opts.transparent ? 1 : 0,
    opts.opacity ?? 1,
    opts.vertexColors ? 1 : 0,
    opts.map ? opts.map.uuid : '-',
  ].join('|');

  const hit = cache.get(key);
  if (hit) return hit;

  const mat = new THREE.MeshToonMaterial({
    color: col,
    gradientMap: getGradientMap(),
    side,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    vertexColors: !!opts.vertexColors,
    map: opts.map ?? null,
    fog: true,
  }) as ToonMaterial;

  if (emissive) {
    mat.emissive = emissive;
    mat.emissiveIntensity = opts.emissiveIntensity ?? 1;
  }

  patch(mat, kind, fadeable);
  cache.set(key, mat);
  return mat;
}

/** Materials whose emissive is driven by the day/night cycle. */
const lampMaterials = new Map<string, ToonMaterial>();

export function makeLampMaterial(key: string, color: THREE.ColorRepresentation): ToonMaterial {
  const hit = lampMaterials.get(key);
  if (hit) return hit;
  const mat = new THREE.MeshToonMaterial({
    color,
    gradientMap: getGradientMap(),
    emissive: new THREE.Color(color),
    emissiveIntensity: 0,
    fog: true,
  }) as ToonMaterial;
  mat.userData.lampKey = key;
  mat.customProgramCacheKey = () => 'lh:lamp';
  lampMaterials.set(key, mat);
  return mat;
}

export function setLampGlow(intensity: number): void {
  for (const m of lampMaterials.values()) m.emissiveIntensity = intensity;
}

export function updateToonTime(t: number, windStrength: number): void {
  toonUniforms.uTime.value = t;
  toonUniforms.uWindStrength.value = windStrength;
}

export function setToonPlayer(p: THREE.Vector3): void {
  toonUniforms.uPlayer.value.copy(p);
}

export function disposeMaterialCache(): void {
  for (const m of cache.values()) m.dispose();
  cache.clear();
  for (const m of lampMaterials.values()) m.dispose();
  lampMaterials.clear();
  gradientMap?.dispose();
  gradientMap = null;
}

/**
 * Rebuild an imported glTF material as a toon material, keeping its base
 * colour. Name-based rules pick the wind/emissive variants so the Blender
 * kit needs no extra metadata.
 */
export function toonFromImported(
  src: THREE.Material,
  nameHint = '',
  opts: { allowWind?: boolean } = {},
): THREE.Material {
  const std = src as THREE.MeshStandardMaterial;
  const color = std.color ? std.color.clone() : new THREE.Color(0xcccccc);
  const n = `${src.name} ${nameHint}`.toLowerCase();

  if (n.includes('lamp_glass')) {
    return makeLampMaterial('lamp_glass', color.getHex());
  }

  /*
   * `leaf_*` and friends are PALETTE COLOUR names in the Blender kit, not
   * semantic foliage markers: book spines, a bed blanket, pens and framed
   * pictures are all authored with `leaf_teal` / `leaf_mid`, and HouseLarge's
   * dormer window box uses `leaf_mid` for its five 24 cm plants.
   *
   * Matching on the name alone therefore handed the tree-canopy wind shader
   * to furniture and to building trim. The dormer plants sit ~6.5 m up, and
   * the sway mask is keyed off *object-space* height against a 4.5 m
   * reference, so they swung with over twice a full tree's amplitude — far
   * enough out of the planter to read as detached geometry by the roof.
   *
   * Wind, occluder fade and double-siding are vegetation treatments, so only
   * the vegetation path may opt in. Everything else renders solid.
   */
  const vegetationName =
    n.includes('leaf') || n.includes('palm_frond') || n.includes('bush');
  const wind = opts.allowWind === true;

  return makeToon(color, {
    kind: wind && vegetationName ? 'foliage' : 'solid',
    fadeable: wind && (vegetationName || n.includes('trunk')),
    side: wind && n.includes('palm_frond') ? THREE.DoubleSide : undefined,
  });
}
