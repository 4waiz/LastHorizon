import * as THREE from 'three';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { makeToon } from '../graphics/ToonMaterial';
import type { NpcAppearance } from './NpcDefinition';

/**
 * NPC bodies, one draw call each.
 *
 * The player's GLB is nine primitives — skin, hair, eye, trim, hat, hat band,
 * shirt, shorts, shoe — which is nine draw calls per person. The outdoor
 * budget is 340 and the village already spends 285, so cloning the player rig
 * as-is would have bought about five pedestrians.
 *
 * So the nine are merged into one geometry and the material colours are baked
 * into a vertex-colour attribute. One draw call per body, and one material per
 * *appearance* rather than per body.
 *
 * The part that makes this cheap rather than merely fewer-draw-calls: every
 * variant geometry **shares the same position, normal and skinning attributes**
 * as every other. Only the colour attribute differs, and it is a normalised
 * byte array, so a variant costs about 9 kB rather than a second copy of the
 * mesh. Twenty-eight variants fit in a quarter of a megabyte.
 *
 * Nothing here is per-NPC: two residents wearing the same clothes share a
 * geometry, a material and a program. What is per-NPC is the skeleton, which
 * has to be, because they are not standing in the same pose.
 */

/**
 * Take a mesh out of every raycast in the game.
 *
 * The camera's occluder fade raycasts the **whole scene** every frame with
 * `firstHitOnly = false`, and a `SkinnedMesh` with no BVH answers by
 * CPU-skinning each of its 4,890 triangles. Thirty-two bodies made that 156,000
 * skinned triangle tests a frame and took the simulation from ~2 ms to ~40 ms —
 * measured, not guessed: it is why the first Playwright run of this phase took
 * a hundred seconds to simulate forty.
 *
 * Nothing needs to raycast an NPC. The fade only touches materials created
 * `fadeable`, which these are not; perception occlusion tests the merged
 * collision proxy, not the scene; and interaction works on distance.
 */
function makeUnraycastable(mesh: THREE.Object3D): void {
  mesh.raycast = () => undefined;
}

/** Which palette slot a source material feeds. */
type ColourSlot = 'skin' | 'hair' | 'eye' | 'trim' | 'hat' | 'hatBand' | 'shirt' | 'trousers' | 'shoe';

const SLOT_FOR_MATERIAL: Record<string, ColourSlot> = {
  skin: 'skin',
  hair: 'hair',
  eye: 'eye',
  trim_white: 'trim',
  hat_straw: 'hat',
  hat_band: 'hatBand',
  shirt: 'shirt',
  shorts: 'trousers',
  shoe: 'shoe',
};

/** Colours that do not vary between residents. */
const FIXED: Record<'skin' | 'hair' | 'eye' | 'trim' | 'shoe', number> = {
  skin: 0xf2cba8,
  hair: 0x2e2420,
  eye: 0x2a2320,
  trim: 0xe9e4d6,
  shoe: 0x9c7f5e,
};

export interface NpcVisualStats {
  /** Distinct appearance variants built. */
  variants: number;
  /** Bodies currently attached to the scene. */
  live: number;
  /** Bodies parked in the pool, ready to be reused. */
  pooled: number;
  /** True when the merge failed and bodies fall back to nine draw calls. */
  degraded: boolean;
}

/** A body checked out of the pool. */
export interface NpcBody {
  readonly root: THREE.Object3D;
  readonly mixer: THREE.AnimationMixer;
  /** Play a clip by name, crossfading from whatever is running. */
  play(clip: string, fade?: number): void;
  /** Swap which appearance this body wears, without rebuilding it. */
  wear(appearance: NpcAppearance): void;
  setVisible(v: boolean): void;
}

interface Variant {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
}

interface PooledBody {
  root: THREE.Object3D;
  mesh: THREE.SkinnedMesh | null;
  /** Nine meshes instead of one, when the merge could not be done. */
  fallbackMeshes: THREE.SkinnedMesh[];
  mixer: THREE.AnimationMixer;
  actions: Map<string, THREE.AnimationAction>;
  current: THREE.AnimationAction | null;
}

export class NpcVisuals {
  /** Shared across every variant. Built once. */
  private baseGeometry: THREE.BufferGeometry | null = null;
  /** Per-vertex palette slot, parallel to the base geometry's vertices. */
  private slots: Uint8Array | null = null;
  private readonly slotOrder: ColourSlot[] = [];

  private readonly variants = new Map<string, Variant>();
  private readonly pool: PooledBody[] = [];
  private readonly live = new Set<PooledBody>();
  /** Root -> pooled record, so `release` is a lookup rather than a scan. */
  private readonly byRoot = new Map<THREE.Object3D, PooledBody>();
  private degraded = false;

  constructor(
    private readonly source: THREE.Object3D,
    private readonly clips: readonly THREE.AnimationClip[],
  ) {
    this.buildBase();
  }

  get stats(): NpcVisualStats {
    return {
      variants: this.variants.size,
      live: this.live.size,
      pooled: this.pool.length,
      degraded: this.degraded,
    };
  }

  /**
   * Merge the source primitives into one geometry and remember which palette
   * slot every vertex belongs to.
   *
   * Morph targets are dropped. The player's Blink morph lives on two of the
   * nine primitives, `mergeGeometries` refuses a set whose morph attributes
   * disagree, and a pedestrian forty metres away does not need eyelids.
   */
  private buildBase(): void {
    const parts: THREE.BufferGeometry[] = [];
    const partSlots: ColourSlot[] = [];

    this.source.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      // `Player` has already replaced the imported materials with toon ones by
      // the time this runs, and the toon cache does not carry the source name.
      // `Game` stashes it in userData before that happens; the material name is
      // the fallback for a rig nothing has converted.
      const material = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      const named = typeof mesh.userData.paletteSlot === 'string'
        ? mesh.userData.paletteSlot
        : (material?.name ?? '');
      const slot = SLOT_FOR_MATERIAL[named];
      if (!slot) return;

      const g = mesh.geometry.clone();
      g.morphAttributes = {};
      g.morphTargetsRelative = false;
      // Keep exactly the four attributes every primitive is guaranteed to
      // have; anything else and mergeGeometries rejects the set.
      for (const name of Object.keys(g.attributes)) {
        if (!['position', 'normal', 'skinIndex', 'skinWeight'].includes(name)) {
          g.deleteAttribute(name);
        }
      }
      parts.push(g);
      partSlots.push(slot);
    });

    if (parts.length === 0) {
      this.degraded = true;
      return;
    }

    let merged: THREE.BufferGeometry | null;
    try {
      merged = mergeGeometries(parts, false);
    } catch {
      merged = null;
    }
    if (!merged) {
      for (const p of parts) p.dispose();
      this.degraded = true;
      return;
    }

    // Walk the parts again in the same order to tag vertices. mergeGeometries
    // concatenates in argument order, so vertex ranges follow the part order.
    const total = merged.getAttribute('position').count;
    const slots = new Uint8Array(total);
    let cursor = 0;
    for (let i = 0; i < parts.length; i++) {
      const n = parts[i].getAttribute('position').count;
      let index = this.slotOrder.indexOf(partSlots[i]);
      if (index < 0) {
        index = this.slotOrder.length;
        this.slotOrder.push(partSlots[i]);
      }
      slots.fill(index, cursor, cursor + n);
      cursor += n;
    }

    // A generous fixed sphere rather than `frustumCulled = false`. Skinned
    // bounds lag the pose, which is why the player disables culling — but the
    // player is one mesh and these are dozens, and an off-screen pedestrian
    // that still costs a draw call defeats the point of merging them.
    merged.computeBoundingSphere();
    const sphere = merged.boundingSphere;
    if (sphere) {
      sphere.center.set(0, 0.95, 0);
      sphere.radius = 1.6;
    }

    for (const p of parts) p.dispose();
    this.baseGeometry = merged;
    this.slots = slots;
  }

  /**
   * Geometry and material for an appearance, built once and shared.
   *
   * The key is the four colours that can vary. Two residents in the same
   * clothes are the same variant, which is the common case for ambient
   * pedestrians drawn from a small wardrobe.
   */
  private variantFor(a: NpcAppearance): Variant | null {
    const base = this.baseGeometry;
    const slots = this.slots;
    if (!base || !slots) return null;

    const key = `${a.shirt}|${a.trousers}|${a.hat ?? '-'}`;
    const existing = this.variants.get(key);
    if (existing) return existing;

    const colourForSlot = (slot: ColourSlot): number => {
      switch (slot) {
        case 'shirt': return new THREE.Color(a.shirt).getHex();
        case 'trousers': return new THREE.Color(a.trousers).getHex();
        case 'hat': return new THREE.Color(a.hat ?? FIXED.hair).getHex();
        case 'hatBand': return new THREE.Color(a.hat ?? FIXED.hair).getHex() & 0xdedede;
        default: return FIXED[slot];
      }
    };

    // sRGB hex straight into a normalised byte attribute. Three reads vertex
    // colours in the working colour space, and the toon materials elsewhere in
    // the game take their colours the same way, so a shirt matches the
    // player's shirt of the same hex exactly.
    const colours = new Uint8Array(slots.length * 3);
    const tmp = new THREE.Color();
    const perSlot = this.slotOrder.map((s) => {
      tmp.setHex(colourForSlot(s), THREE.SRGBColorSpace);
      return [
        Math.round(THREE.MathUtils.clamp(tmp.r, 0, 1) * 255),
        Math.round(THREE.MathUtils.clamp(tmp.g, 0, 1) * 255),
        Math.round(THREE.MathUtils.clamp(tmp.b, 0, 1) * 255),
      ];
    });
    for (let i = 0; i < slots.length; i++) {
      const rgb = perSlot[slots[i]] ?? [255, 255, 255];
      colours[i * 3] = rgb[0];
      colours[i * 3 + 1] = rgb[1];
      colours[i * 3 + 2] = rgb[2];
    }

    // Shares every attribute with the base except colour. This is what keeps
    // a variant at ~9 kB instead of a second copy of a 4,890-triangle body.
    const geometry = new THREE.BufferGeometry();
    for (const [name, attr] of Object.entries(base.attributes)) {
      geometry.setAttribute(name, attr as THREE.BufferAttribute);
    }
    const index = base.getIndex();
    if (index) geometry.setIndex(index);
    geometry.setAttribute('color', new THREE.BufferAttribute(colours, 3, true));
    geometry.boundingSphere = base.boundingSphere?.clone() ?? null;

    const material = makeToon(0xffffff, { vertexColors: true, kind: 'solid', id: 'npc_body' });
    const variant: Variant = { geometry, material };
    this.variants.set(key, variant);
    return variant;
  }

  /** Check a body out of the pool, building one if the pool is empty. */
  acquire(appearance: NpcAppearance): NpcBody {
    const pooled = this.pool.pop() ?? this.build();
    this.live.add(pooled);
    this.byRoot.set(pooled.root, pooled);
    pooled.root.visible = true;
    const body = this.wrap(pooled);
    body.wear(appearance);
    return body;
  }

  /**
   * Return a body to the pool.
   *
   * Stopped, hidden and detached from the scene, but not disposed: the
   * skeleton and the mixer are the expensive parts and they are reusable. Only
   * `dispose` actually frees anything.
   */
  release(body: NpcBody): void {
    const pooled = this.byRoot.get(body.root);
    if (!pooled || !this.live.has(pooled)) return;
    this.live.delete(pooled);
    pooled.mixer.stopAllAction();
    pooled.current = null;
    pooled.root.visible = false;
    pooled.root.removeFromParent();
    this.pool.push(pooled);
  }

  private build(): PooledBody {
    const root = cloneSkinned(this.source);
    root.name = 'NpcBody';

    // The rig this was cloned from is the player's own, and `AgeAppearance`
    // writes bone *scale* to express age. Nothing in the GLB keys scale, so
    // the authored rest value is 1 across the board and resetting is exact —
    // without it every resident inherits whatever age the player happens to be.
    root.traverse((o) => {
      if ((o as THREE.Bone).isBone) o.scale.set(1, 1, 1);
    });

    let skeleton: THREE.Skeleton | null = null;
    let bindMatrix: THREE.Matrix4 | null = null;
    let parent: THREE.Object3D | null = null;
    const sourceMeshes: THREE.SkinnedMesh[] = [];

    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (!mesh.isSkinnedMesh) return;
      skeleton ??= mesh.skeleton;
      bindMatrix ??= mesh.bindMatrix;
      parent ??= mesh.parent;
      sourceMeshes.push(mesh);
    });

    const mixer = new THREE.AnimationMixer(root);
    const pooled: PooledBody = {
      root,
      mesh: null,
      fallbackMeshes: [],
      mixer,
      actions: new Map(),
      current: null,
    };

    if (this.baseGeometry && skeleton && bindMatrix && parent) {
      for (const m of sourceMeshes) m.removeFromParent();
      // Placeholder geometry and material; `wear` swaps in the real variant.
      const mesh = new THREE.SkinnedMesh(this.baseGeometry, new THREE.MeshBasicMaterial());
      mesh.name = 'NpcBodyMesh';
      mesh.castShadow = true;
      mesh.receiveShadow = false; // one bounce is enough on a 5k-triangle body
      makeUnraycastable(mesh);
      (parent as THREE.Object3D).add(mesh);
      mesh.bind(skeleton, bindMatrix);
      pooled.mesh = mesh;
    } else {
      // Merge unavailable. Nine draw calls a body, which the caller keeps in
      // check by refusing to promote as many NPCs to the near tier.
      this.degraded = true;
      pooled.fallbackMeshes = sourceMeshes;
      for (const m of sourceMeshes) {
        m.castShadow = true;
        m.frustumCulled = false;
        makeUnraycastable(m);
      }
    }

    return pooled;
  }

  private wrap(pooled: PooledBody): NpcBody {
    return {
      root: pooled.root,
      mixer: pooled.mixer,
      play: (clip, fade = 0.2) => this.playOn(pooled, clip, fade),
      wear: (appearance) => this.wearOn(pooled, appearance),
      setVisible: (v) => {
        pooled.root.visible = v;
      },
    };
  }

  private wearOn(pooled: PooledBody, appearance: NpcAppearance): void {
    // Build is a slight non-uniform scale on the root rather than per-bone
    // work. At +-4% the normals are wrong by an amount three flat toon bands
    // cannot show, and it buys a visibly different silhouette for one vector
    // assignment instead of a second copy of `AgeAppearance`.
    const width = appearance.build === 'stocky' ? 1.04 : appearance.build === 'slight' ? 0.96 : 1;
    pooled.root.scale.set(appearance.scale * width, appearance.scale, appearance.scale * width);
    const variant = this.variantFor(appearance);
    if (!variant || !pooled.mesh) return;
    pooled.mesh.geometry = variant.geometry;
    pooled.mesh.material = variant.material;
  }

  private playOn(pooled: PooledBody, clipName: string, fade: number): void {
    let action = pooled.actions.get(clipName);
    if (!action) {
      const clip = this.clips.find((c) => c.name === clipName);
      if (!clip) return;
      action = pooled.mixer.clipAction(clip);
      pooled.actions.set(clipName, action);
    }
    if (pooled.current === action && action.isRunning()) return;

    action.reset().setLoop(THREE.LoopRepeat, Infinity).setEffectiveWeight(1).play();
    if (pooled.current && pooled.current !== action) {
      pooled.current.crossFadeTo(action, fade, false);
    }
    pooled.current = action;
  }

  /**
   * Free everything.
   *
   * The shared attributes are owned by the base geometry, so disposing a
   * variant first and the base afterwards would double-free the position
   * buffer. Variants are told to forget their shared attributes before their
   * own colour buffer goes.
   */
  dispose(): void {
    for (const pooled of [...this.live, ...this.pool]) {
      pooled.mixer.stopAllAction();
      pooled.mixer.uncacheRoot(pooled.root);
      pooled.root.removeFromParent();
    }
    this.live.clear();
    this.pool.length = 0;
    this.byRoot.clear();

    for (const variant of this.variants.values()) {
      const colour = variant.geometry.getAttribute('color');
      variant.geometry.setIndex(null);
      for (const name of Object.keys(variant.geometry.attributes)) {
        variant.geometry.deleteAttribute(name);
      }
      // Re-attach and dispose so the colour buffer's own GPU resource goes.
      if (colour) variant.geometry.setAttribute('color', colour as THREE.BufferAttribute);
      variant.geometry.dispose();
      variant.material.dispose();
    }
    this.variants.clear();

    this.baseGeometry?.dispose();
    this.baseGeometry = null;
    this.slots = null;
    this.slotOrder.length = 0;
  }
}

// ---------------------------------------------------------------------------
// Ambient wardrobe
// ---------------------------------------------------------------------------

const AMBIENT_SHIRTS = ['#efede2', '#e6d3b8', '#cfd9e4', '#d8c3c8', '#c9d8c2', '#b9c4d6'];
const AMBIENT_TROUSERS = ['#9b8fc7', '#8a9455', '#7f8a9c', '#b08b6a', '#5f6b7a', '#c2a2a8'];
const AMBIENT_HATS = [null, null, null, '#dcc177', '#c9584b', '#7f9ec4', '#8fae7a'];

/**
 * A deterministic pedestrian, from a seed.
 *
 * Seeded rather than random so a chunk repopulates with the same faces after a
 * reload, and so a screenshot test is reproducible. Three hats in seven means
 * most people are bare-headed, which is what stops a street looking like a
 * uniform parade.
 */
export function ambientAppearance(seed: number): NpcAppearance {
  const h = hash(seed);
  const builds = ['slight', 'average', 'stocky'] as const;
  return {
    shirt: AMBIENT_SHIRTS[h % AMBIENT_SHIRTS.length],
    trousers: AMBIENT_TROUSERS[(h >>> 4) % AMBIENT_TROUSERS.length],
    hat: AMBIENT_HATS[(h >>> 8) % AMBIENT_HATS.length],
    scale: 0.93 + ((h >>> 12) % 12) * 0.012,
    build: builds[(h >>> 16) % builds.length],
  };
}

function hash(n: number): number {
  let h = n | 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  h ^= h >>> 15;
  return h >>> 0;
}
