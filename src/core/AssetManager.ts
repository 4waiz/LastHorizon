import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loads the generated GLB packs and indexes their root objects by name.
 *
 * The environment packs each contain several root objects (HouseLarge,
 * Streetlight, TreeBig, ...) rather than one file per prop, which keeps the
 * request count low and lets Three share buffers across the pack.
 *
 * Six packs load eagerly, during the loading screen. The seventh — the
 * interior kit — is fetched by `loadInteriorKit()` the first time somebody
 * opens a door. See that method for why.
 *
 * Meshopt is wired up so a compressed rebuild of the kit drops straight in;
 * the current kit is small enough (~1.2 MB total) that compressing it would
 * cost more in decoder weight than it saves.
 */

export interface AssetBundle {
  player: { scene: THREE.Object3D | null; clips: THREE.AnimationClip[] };
  buildings: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  nature: Map<string, THREE.Object3D>;
  collectibles: Map<string, THREE.Object3D>;
  /** Base meshes, LODs and collision proxies, keyed by node name. */
  vehicles: Map<string, THREE.Object3D>;
}

export interface LoadProgress {
  loaded: number;
  total: number;
  fraction: number;
  label: string;
}

const PACKS = [
  { key: 'player', file: 'player.glb', label: 'the explorer' },
  { key: 'buildings', file: 'buildings.glb', label: 'the houses' },
  { key: 'props', file: 'props.glb', label: 'the street' },
  { key: 'nature', file: 'nature.glb', label: 'the trees' },
  { key: 'collectibles', file: 'collectibles.glb', label: 'small treasures' },
  { key: 'vehicles', file: 'vehicles.glb', label: 'something to ride' },
] as const;

export class AssetManager {
  private loader: GLTFLoader;
  readonly failures: string[] = [];

  /** In flight or resolved. The kit is fetched at most once per session. */
  private kitPromise: Promise<Map<string, THREE.Object3D>> | null = null;

  constructor(private readonly baseUrl = './assets/models/') {
    this.loader = new GLTFLoader();
    try {
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    } catch {
      /* decoder unavailable — uncompressed packs still load */
    }
  }

  /**
   * Fetch the modular interior kit.
   *
   * Deliberately not in `PACKS`. The kit is 138.6 kB that only matters once
   * somebody walks through a door, and that transition already fades to black
   * — so the fetch is free in wall-clock terms for the player who does, and
   * genuinely free for the player who does not. `initial load` had 65 kB of
   * headroom when this was written; putting the kit on the startup path would
   * have blown it.
   *
   * Returns an empty map rather than throwing on failure, matching `loadAll`:
   * a door that cannot furnish its room should decline to open, not crash the
   * frame loop.
   */
  loadInteriorKit(): Promise<Map<string, THREE.Object3D>> {
    this.kitPromise ??= this.fetchPack('interior_kit.glb');
    return this.kitPromise;
  }

  /**
   * Fetch the three firearms.
   *
   * Lazy for the same reason as the kit, and more strongly: a player who never
   * commits a crime, and every player under eighteen, has no use for it at all.
   * 65 kB is small, but `initial load` had 13 kB of headroom after Phase 8 —
   * putting this on the startup path would have failed the gate outright.
   */
  loadWeapons(): Promise<Map<string, THREE.Object3D>> {
    this.weaponsPromise ??= this.fetchPack('weapons.glb');
    return this.weaponsPromise;
  }

  private weaponsPromise: Promise<Map<string, THREE.Object3D>> | null = null;

  private async fetchPack(file: string): Promise<Map<string, THREE.Object3D>> {
    const out = new Map<string, THREE.Object3D>();
    try {
      const gltf = await this.loader.loadAsync(this.baseUrl + file);
      for (const child of [...gltf.scene.children]) {
        child.updateWorldMatrix(true, true);
        child.removeFromParent();
        child.position.set(0, 0, 0);
        child.rotation.set(0, 0, 0);
        child.scale.set(1, 1, 1);
        child.updateMatrixWorld(true);
        out.set(child.name, child);
      }
    } catch (err) {
      this.failures.push(`${file}: ${(err as Error).message}`);
      console.warn(`[LastHorizon] could not load ${file}`, err);
    }
    return out;
  }

  async loadAll(onProgress: (p: LoadProgress) => void): Promise<AssetBundle> {
    const bundle: AssetBundle = {
      player: { scene: null, clips: [] },
      buildings: new Map(),
      props: new Map(),
      nature: new Map(),
      collectibles: new Map(),
      vehicles: new Map(),
    };

    for (let i = 0; i < PACKS.length; i++) {
      const pack = PACKS[i];
      onProgress({
        loaded: i,
        total: PACKS.length,
        fraction: i / PACKS.length,
        label: pack.label,
      });

      try {
        const gltf = await this.loader.loadAsync(this.baseUrl + pack.file);
        if (pack.key === 'player') {
          bundle.player.scene = gltf.scene;
          bundle.player.clips = gltf.animations;
        } else {
          const target = bundle[pack.key];
          // Copy children out first: iterating gltf.scene.children while
          // reparenting mutates the array underneath the loop.
          for (const child of [...gltf.scene.children]) {
            child.updateWorldMatrix(true, true);
            child.removeFromParent();
            child.position.set(0, 0, 0);
            child.rotation.set(0, 0, 0);
            child.scale.set(1, 1, 1);
            child.updateMatrixWorld(true);
            target.set(child.name, child);
          }
        }
      } catch (err) {
        this.failures.push(`${pack.file}: ${(err as Error).message}`);
        console.warn(`[LastHorizon] could not load ${pack.file}`, err);
      }
    }

    onProgress({ loaded: PACKS.length, total: PACKS.length, fraction: 1, label: 'the afternoon' });
    return bundle;
  }
}
