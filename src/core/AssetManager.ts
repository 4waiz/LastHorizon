import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loads the five generated GLB packs and indexes their root objects by name.
 *
 * The environment packs each contain several root objects (HouseLarge,
 * Streetlight, TreeBig, ...) rather than one file per prop, which keeps the
 * request count at five and lets Three share buffers across the pack.
 *
 * Meshopt is wired up so a compressed rebuild of the kit drops straight in;
 * the current kit is small enough (~850 KB total) that compressing it would
 * cost more in decoder weight than it saves.
 */

export interface AssetBundle {
  player: { scene: THREE.Object3D | null; clips: THREE.AnimationClip[] };
  buildings: Map<string, THREE.Object3D>;
  props: Map<string, THREE.Object3D>;
  nature: Map<string, THREE.Object3D>;
  collectibles: Map<string, THREE.Object3D>;
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
] as const;

export class AssetManager {
  private loader: GLTFLoader;
  readonly failures: string[] = [];

  constructor(private readonly baseUrl = './assets/models/') {
    this.loader = new GLTFLoader();
    try {
      this.loader.setMeshoptDecoder(MeshoptDecoder);
    } catch {
      /* decoder unavailable — uncompressed packs still load */
    }
  }

  async loadAll(onProgress: (p: LoadProgress) => void): Promise<AssetBundle> {
    const bundle: AssetBundle = {
      player: { scene: null, clips: [] },
      buildings: new Map(),
      props: new Map(),
      nature: new Map(),
      collectibles: new Map(),
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
