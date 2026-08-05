import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { CollisionWorld } from '../physics/CollisionWorld';
import { CharacterMotor, DEFAULT_MOTOR } from '../physics/CharacterMotor';
import { PlayerAnimator } from './PlayerAnimator';
import { PlayerController } from './PlayerController';
import { PlayerState, PlayerStateMachine } from './PlayerStateMachine';
import { makeToon, toonFromImported } from '../graphics/ToonMaterial';

/** Wardrobe slots, keyed by the Blender material name they came from. */
const OUTFIT_SLOTS: Record<string, OutfitSlot> = {
  shirt: 'shirt',
  shorts: 'trousers',
  hat_straw: 'hat',
  hat_band: 'hatBand',
};

export type OutfitSlot = 'shirt' | 'trousers' | 'hat' | 'hatBand';

export interface Outfit {
  shirt: string;
  trousers: string;
  hat: string;
  hatOn: boolean;
}

export const DEFAULT_OUTFIT: Outfit = {
  shirt: '#efede2',
  trousers: '#9b8fc7',
  hat: '#dcc177',
  hatOn: true,
};

const OUTFIT_KEY = 'lasthorizon.outfit.v1';

/** The playable character: model, rig, motor, controller and state machine. */
export class Player {
  readonly root = new THREE.Group();
  readonly motor: CharacterMotor;
  readonly controller: PlayerController;
  readonly states = new PlayerStateMachine();
  readonly animator: PlayerAnimator | null;

  /** Roughly chest height — what the camera actually looks at. */
  readonly lookTarget = new THREE.Vector3();

  private model: THREE.Object3D | null = null;
  /** Player-only material instances, so recolouring cannot leak elsewhere. */
  private readonly slots = new Map<OutfitSlot, THREE.MeshToonMaterial>();
  readonly outfit: Outfit = { ...DEFAULT_OUTFIT };
  private sitting = false;

  constructor(gltfScene: THREE.Object3D | null, clips: THREE.AnimationClip[], input: InputManager) {
    this.root.name = 'Player';
    this.loadOutfit();
    this.motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    this.controller = new PlayerController(this.motor, input);

    if (gltfScene) {
      this.model = gltfScene;
      this.model.traverse((o) => {
        const mesh = o as THREE.Mesh | THREE.SkinnedMesh;
        if ((mesh as THREE.Mesh).isMesh) {
          mesh.castShadow = true;
          mesh.receiveShadow = true;
          mesh.frustumCulled = false; // skinned bounds lag behind the pose
          const convert = (src: THREE.Material): THREE.Material => {
            const slot = OUTFIT_SLOTS[src.name];
            if (!slot) return toonFromImported(src, 'player');
            // Unique instance per slot: the shared cache would otherwise
            // repaint every prop that happens to use the same colour.
            const base = (src as THREE.MeshStandardMaterial).color?.getHex() ?? 0xffffff;
            const mat = makeToon(base, { id: 'outfit_' + slot });
            this.slots.set(slot, mat);
            return mat;
          };
          const m = mesh.material;
          if (Array.isArray(m)) mesh.material = m.map(convert);
          else if (m) mesh.material = convert(m);
        }
      });
      this.root.add(this.model);
      this.applyOutfit();
      this.animator = new PlayerAnimator(this.model, clips);
      this.animator.play('idle', true);
    } else {
      // Fall back to a visible capsule rather than an invisible player.
      const geo = new THREE.CapsuleGeometry(DEFAULT_MOTOR.radius, DEFAULT_MOTOR.height - DEFAULT_MOTOR.radius * 2, 4, 10);
      const mesh = new THREE.Mesh(geo, new THREE.MeshToonMaterial({ color: 0xefede2 }));
      mesh.position.y = DEFAULT_MOTOR.height / 2;
      mesh.castShadow = true;
      this.root.add(mesh);
      this.animator = null;
    }
  }

  /** Recolour a slot and persist the whole outfit. */
  setOutfit(patch: Partial<Outfit>): void {
    Object.assign(this.outfit, patch);
    this.applyOutfit();
    try {
      localStorage.setItem(OUTFIT_KEY, JSON.stringify(this.outfit));
    } catch {
      /* private browsing — the outfit just won't survive the session */
    }
  }

  private loadOutfit(): void {
    try {
      const raw = localStorage.getItem(OUTFIT_KEY);
      if (raw) Object.assign(this.outfit, JSON.parse(raw) as Partial<Outfit>);
    } catch {
      /* fall back to the default outfit */
    }
  }

  private applyOutfit(): void {
    this.slots.get('shirt')?.color.set(this.outfit.shirt);
    this.slots.get('trousers')?.color.set(this.outfit.trousers);
    const hat = this.slots.get('hat');
    const band = this.slots.get('hatBand');
    if (hat) {
      hat.color.set(this.outfit.hat);
      hat.transparent = !this.outfit.hatOn;
      hat.opacity = this.outfit.hatOn ? 1 : 0;
      hat.depthWrite = this.outfit.hatOn;
      hat.needsUpdate = true;
    }
    if (band) {
      band.transparent = !this.outfit.hatOn;
      band.opacity = this.outfit.hatOn ? 1 : 0;
      band.depthWrite = this.outfit.hatOn;
      band.needsUpdate = true;
    }
  }

  /** Freeze the character into the seated pose (or release it). */
  setSitting(on: boolean): void {
    this.sitting = on;
    if (on) {
      this.motor.velocity.set(0, 0, 0);
      this.states.reset('sit');
    }
  }

  get isSitting(): boolean {
    return this.sitting;
  }

  get isLying(): boolean {
    return this.lying;
  }

  get position(): THREE.Vector3 {
    return this.motor.position;
  }

  get state(): PlayerState {
    return this.states.state;
  }

  get speed(): number {
    return this.controller.planarSpeed;
  }

  setSpawn(p: THREE.Vector3, facing: number): void {
    this.controller.setSpawn(p, facing);
    this.syncTransform();
  }

  /** Lay the character down (on a bed) or stand them back up. */
  setLying(on: boolean): void {
    this.lying = on;
    this.syncTransform();
  }

  private lying = false;

  private syncTransform(): void {
    this.root.position.copy(this.motor.position);
    this.root.rotation.set(0, this.controller.facing, 0);
    if (this.lying) {
      // Tip onto the back and lift clear of the floor so the model rests on
      // the mattress rather than sinking through it.
      this.root.rotation.x = -Math.PI / 2;
      this.root.position.y += 0.30;
      this.lookTarget.set(
        this.motor.position.x,
        this.motor.position.y + 0.55,
        this.motor.position.z,
      );
      return;
    }
    this.lookTarget.set(
      this.motor.position.x,
      this.motor.position.y + this.motor.config.height * 0.72,
      this.motor.position.z,
    );
  }

  update(
    dt: number,
    world: CollisionWorld,
    camForward: THREE.Vector3,
    camRight: THREE.Vector3,
    inBounds: (x: number, z: number) => boolean,
  ): void {
    if (this.sitting) {
      this.motor.velocity.set(0, 0, 0);
      this.animator?.update(dt, 'sit', 0);
      this.syncTransform();
      return;
    }

    this.controller.update(dt, world, camForward, camRight, inBounds);

    const motor = this.motor;
    this.states.update(dt, {
      grounded: motor.grounded,
      planarSpeed: this.controller.planarSpeed,
      jumpTriggered: this.controller.jumpedThisFrame,
      airTime: motor.airTime,
      justLanded: motor.justLanded,
      impactSpeed: motor.justLanded ? motor.lastImpactSpeed : 0,
    });

    this.animator?.update(dt, this.states.state, this.controller.planarSpeed);
    this.syncTransform();
  }

  dispose(): void {
    this.animator?.dispose();
    this.model = null;
  }
}
