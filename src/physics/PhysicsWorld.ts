import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';

/**
 * Rigid-body physics, for vehicles.
 *
 * ## Why this is loaded lazily
 *
 * `@dimforge/rapier3d-compat` ships its 1.57 MB WebAssembly module inlined as
 * base64, which makes `rapier.mjs` **2.2 MB**. The whole `dist/` budget is
 * 4,200 kB and Phase 4 left it at 3,914 kB, so importing Rapier eagerly
 * overshoots by roughly 1.9 MB — and it would do so on the loading screen, for
 * every player, including the ones who never get on a bicycle.
 *
 * `import type` above is erased at compile time and costs nothing. The runtime
 * module arrives only through the dynamic `import()` in `loadRapier`, which
 * Vite splits into its own chunk. That is the same technique `main.ts` uses to
 * keep the test bridge out of the main bundle.
 *
 * ## Why the BVH stays
 *
 * The character motor runs on `CollisionWorld`'s BVH and works. Rapier is
 * added *beside* it rather than replacing it: both read the same merged proxy
 * geometry, so there is still one source of truth for what the world is solid
 * against, and the character's feel is not up for renegotiation because
 * vehicles arrived.
 */

/** Loaded once and shared; `init()` must finish before anything else is called. */
let rapierPromise: Promise<typeof RAPIER> | null = null;

export function loadRapier(): Promise<typeof RAPIER> {
  rapierPromise ??= import('@dimforge/rapier3d-compat').then(async (mod) => {
    await mod.init();
    return mod;
  });
  return rapierPromise;
}

/** True once the module is resident, so callers can avoid an await on the hot path. */
export function rapierLoaded(): boolean {
  return rapierPromise !== null;
}

/**
 * Test seam: hand in a module instead of fetching one.
 *
 * Unit tests must not pull 2.2 MB of WebAssembly into jsdom. Passing `null`
 * clears it again so one test cannot leak a stub into the next.
 */
export function __setRapierForTests(mod: typeof RAPIER | null): void {
  rapierPromise = mod === null ? null : Promise.resolve(mod);
}

// ---------------------------------------------------------------------------
// Safety limits
// ---------------------------------------------------------------------------

/**
 * Hard ceilings, applied after every step.
 *
 * "The player must never be launched by a numerical explosion" is an
 * acceptance criterion, not a nice-to-have, and a solver *will* occasionally
 * produce a non-finite or absurd velocity — a wheel starting the frame inside
 * a kerb is enough. Catching it here means every body is covered by
 * construction, rather than each vehicle controller having to remember.
 */
export const MAX_SPEED = 90;
/** Radians per second. A car spinning faster than this has already gone wrong. */
export const MAX_ANGULAR_SPEED = 12;
/** Below the terrain floor, a body has fallen out of the world. */
export const WORLD_FLOOR_Y = -80;

export type BodyId = number;

export interface TrackedBodyOptions {
  /** Restore here if the body explodes or falls out of the world. */
  readonly recovery?: THREE.Vector3;
  /** Skip interpolation sampling — useful for bodies nothing renders. */
  readonly interpolate?: boolean;
}

interface Snapshot {
  readonly position: THREE.Vector3;
  readonly quaternion: THREE.Quaternion;
}

interface Tracked {
  readonly id: BodyId;
  readonly body: RAPIER.RigidBody;
  readonly interpolate: boolean;
  recovery: THREE.Vector3 | null;
  prev: Snapshot;
  curr: Snapshot;
  /** Steps since this body was last rescued, for reporting. */
  recoveries: number;
}

const snap = (): Snapshot => ({
  position: new THREE.Vector3(),
  quaternion: new THREE.Quaternion(),
});

export interface PhysicsStats {
  readonly bodies: number;
  readonly colliders: number;
  readonly steps: number;
  /** Times a body had to be rescued from a non-finite or absurd state. */
  readonly recoveries: number;
}

/**
 * The dynamic world.
 *
 * Stepped at a fixed rate by `SimulationClock`; `sample(alpha)` interpolates
 * for render so a 60 Hz simulation does not stutter on a 144 Hz display.
 */
export class PhysicsWorld {
  private world: RAPIER.World;
  private readonly tracked = new Map<BodyId, Tracked>();
  private nextId: BodyId = 1;
  private staticCollider: RAPIER.Collider | null = null;
  private stepCount = 0;
  private recoveryCount = 0;

  private constructor(
    readonly rapier: typeof RAPIER,
    readonly stepSeconds: number,
  ) {
    this.world = new rapier.World({ x: 0, y: -9.81, z: 0 });
    // Rapier integrates using its own timestep, so it has to agree with the
    // clock driving it or the two disagree about how much time has passed.
    this.world.timestep = stepSeconds;
  }

  static async create(stepSeconds = 1 / 60): Promise<PhysicsWorld> {
    const rapier = await loadRapier();
    return new PhysicsWorld(rapier, stepSeconds);
  }

  /** Direct access, for the vehicle controllers that need Rapier's own types. */
  get raw(): RAPIER.World {
    return this.world;
  }

  get stats(): PhysicsStats {
    return {
      bodies: this.tracked.size,
      colliders: this.world.colliders.len(),
      steps: this.stepCount,
      recoveries: this.recoveryCount,
    };
  }

  // -------------------------------------------------------------- static world

  /**
   * Build the immovable world from the same merged geometry the BVH uses.
   *
   * Taking `CollisionWorld`'s output rather than the render meshes is
   * deliberate: those proxies are boxes for houses and cylinders for trunks,
   * so the trimesh stays small, and a road marking still cannot become
   * something a wheel trips over.
   */
  setStaticGeometry(geometry: THREE.BufferGeometry): void {
    this.clearStaticGeometry();

    const pos = geometry.getAttribute('position');
    if (!pos || pos.count === 0) return;

    const vertices = new Float32Array(pos.array.buffer.slice(0));
    const index = geometry.getIndex();
    const indices = index
      ? Uint32Array.from(index.array)
      : Uint32Array.from({ length: pos.count }, (_, i) => i);

    const body = this.world.createRigidBody(this.rapier.RigidBodyDesc.fixed());
    const desc = this.rapier.ColliderDesc.trimesh(vertices, indices);
    this.staticCollider = this.world.createCollider(desc, body);
  }

  private clearStaticGeometry(): void {
    if (!this.staticCollider) return;
    const body = this.staticCollider.parent();
    this.world.removeCollider(this.staticCollider, false);
    if (body) this.world.removeRigidBody(body);
    this.staticCollider = null;
  }

  get hasStaticGeometry(): boolean {
    return this.staticCollider !== null;
  }

  // ------------------------------------------------------------------- bodies

  /**
   * Track a body so it is interpolated for render and covered by the safety
   * clamps. Returns the id used to sample and remove it.
   */
  track(body: RAPIER.RigidBody, opts: TrackedBodyOptions = {}): BodyId {
    const id = this.nextId++;
    const entry: Tracked = {
      id,
      body,
      interpolate: opts.interpolate ?? true,
      recovery: opts.recovery ? opts.recovery.clone() : null,
      prev: snap(),
      curr: snap(),
      recoveries: 0,
    };
    this.readInto(entry, entry.curr);
    entry.prev.position.copy(entry.curr.position);
    entry.prev.quaternion.copy(entry.curr.quaternion);
    this.tracked.set(id, entry);
    return id;
  }

  untrack(id: BodyId): void {
    const entry = this.tracked.get(id);
    if (!entry) return;
    this.world.removeRigidBody(entry.body);
    this.tracked.delete(id);
  }

  bodyOf(id: BodyId): RAPIER.RigidBody | null {
    return this.tracked.get(id)?.body ?? null;
  }

  /** Move a body's rescue point — where it lands if the solver loses it. */
  setRecoveryPoint(id: BodyId, at: THREE.Vector3): void {
    const entry = this.tracked.get(id);
    if (entry) entry.recovery = at.clone();
  }

  /**
   * Interpolated transform for render.
   *
   * `alpha` is `SimulationClock.alpha`: how far the renderer is between the
   * last two simulation steps.
   */
  sample(id: BodyId, alpha: number, outPos: THREE.Vector3, outQuat: THREE.Quaternion): boolean {
    const entry = this.tracked.get(id);
    if (!entry) return false;
    if (!entry.interpolate) {
      outPos.copy(entry.curr.position);
      outQuat.copy(entry.curr.quaternion);
      return true;
    }
    const t = Math.min(1, Math.max(0, alpha));
    outPos.copy(entry.prev.position).lerp(entry.curr.position, t);
    outQuat.copy(entry.prev.quaternion).slerp(entry.curr.quaternion, t);
    return true;
  }

  // -------------------------------------------------------------------- step

  /**
   * Advance one fixed step.
   *
   * The previous transform is captured *before* stepping, so `sample` always
   * has two real states to interpolate between rather than a duplicate.
   */
  step(): void {
    for (const entry of this.tracked.values()) {
      entry.prev.position.copy(entry.curr.position);
      entry.prev.quaternion.copy(entry.curr.quaternion);
    }

    this.world.step();
    this.stepCount++;

    for (const entry of this.tracked.values()) {
      this.enforceLimits(entry);
      this.readInto(entry, entry.curr);
    }
  }

  private readInto(entry: Tracked, into: Snapshot): void {
    const t = entry.body.translation();
    const r = entry.body.rotation();
    into.position.set(t.x, t.y, t.z);
    into.quaternion.set(r.x, r.y, r.z, r.w);
  }

  /**
   * Catch a body that has gone numerically wrong, before it is rendered.
   *
   * Three failures, in the order they actually happen: a non-finite transform
   * (the solver diverged), a speed no vehicle in this game can reach (a wheel
   * resolved out of a kerb with enormous force), and a body below the world
   * floor (it fell through something). The first is unrecoverable and gets a
   * teleport; the others are clamped in place, which is far less jarring.
   */
  private enforceLimits(entry: Tracked): void {
    const t = entry.body.translation();
    const r = entry.body.rotation();
    const v = entry.body.linvel();
    const w = entry.body.angvel();

    const finite =
      Number.isFinite(t.x) && Number.isFinite(t.y) && Number.isFinite(t.z) &&
      Number.isFinite(r.x) && Number.isFinite(r.y) && Number.isFinite(r.z) && Number.isFinite(r.w) &&
      Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);

    if (!finite || t.y < WORLD_FLOOR_Y) {
      this.rescue(entry);
      return;
    }

    const speed = Math.hypot(v.x, v.y, v.z);
    if (speed > MAX_SPEED) {
      const k = MAX_SPEED / speed;
      entry.body.setLinvel({ x: v.x * k, y: v.y * k, z: v.z * k }, true);
    }

    const spin = Math.hypot(w.x, w.y, w.z);
    if (spin > MAX_ANGULAR_SPEED) {
      const k = MAX_ANGULAR_SPEED / spin;
      entry.body.setAngvel({ x: w.x * k, y: w.y * k, z: w.z * k }, true);
    }
  }

  /** Put a lost body back somewhere valid, at rest and upright. */
  private rescue(entry: Tracked): void {
    const to = entry.recovery ?? entry.prev.position;
    entry.body.setTranslation({ x: to.x, y: to.y, z: to.z }, true);
    entry.body.setRotation({ x: 0, y: 0, z: 0, w: 1 }, true);
    entry.body.setLinvel({ x: 0, y: 0, z: 0 }, true);
    entry.body.setAngvel({ x: 0, y: 0, z: 0 }, true);
    entry.recoveries++;
    this.recoveryCount++;

    // Collapse the interpolation history too. Without this the renderer would
    // sweep the vehicle across the map over one frame, drawing the teleport as
    // a very fast drive rather than a cut.
    this.readInto(entry, entry.curr);
    entry.prev.position.copy(entry.curr.position);
    entry.prev.quaternion.copy(entry.curr.quaternion);
  }

  /** How many times a specific body has been rescued. */
  recoveriesOf(id: BodyId): number {
    return this.tracked.get(id)?.recoveries ?? 0;
  }

  dispose(): void {
    this.clearStaticGeometry();
    this.tracked.clear();
    this.world.free();
  }
}
