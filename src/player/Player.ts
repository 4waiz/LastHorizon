import * as THREE from 'three';
import { InputManager } from '../core/InputManager';
import { CollisionWorld } from '../physics/CollisionWorld';
import { CharacterMotor, DEFAULT_MOTOR } from '../physics/CharacterMotor';
import { PlayerAnimator } from './PlayerAnimator';
import { PlayerController } from './PlayerController';
import { PlayerState, PlayerStateMachine } from './PlayerStateMachine';
import { toonFromImported } from '../graphics/ToonMaterial';

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

  constructor(gltfScene: THREE.Object3D | null, clips: THREE.AnimationClip[], input: InputManager) {
    this.root.name = 'Player';
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
          const m = mesh.material;
          if (Array.isArray(m)) {
            mesh.material = m.map((mm) => toonFromImported(mm, 'player'));
          } else if (m) {
            mesh.material = toonFromImported(m, 'player');
          }
        }
      });
      this.root.add(this.model);
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
