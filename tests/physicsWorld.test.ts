import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as THREE from 'three';
import type * as RAPIER from '@dimforge/rapier3d-compat';
import {
  PhysicsWorld,
  MAX_SPEED,
  MAX_ANGULAR_SPEED,
  WORLD_FLOOR_Y,
  __setRapierForTests,
  rapierLoaded,
} from '../src/physics/PhysicsWorld';

/**
 * A stand-in for Rapier.
 *
 * The real module is 2.2 MB of base64 WebAssembly and has no business being
 * pulled into jsdom. What is under test here is not Rapier — it is the
 * interpolation, the safety ceilings and the rescue path, all of which are
 * hand-written and all of which exist precisely for the moments when the
 * solver misbehaves. A stub can produce those moments on demand; the real
 * engine cannot be asked to diverge to order.
 */

type Vec = { x: number; y: number; z: number };
type Quat = { x: number; y: number; z: number; w: number };

class FakeBody {
  t: Vec = { x: 0, y: 0, z: 0 };
  r: Quat = { x: 0, y: 0, z: 0, w: 1 };
  v: Vec = { x: 0, y: 0, z: 0 };
  w: Vec = { x: 0, y: 0, z: 0 };
  removed = false;

  translation() { return this.t; }
  rotation() { return this.r; }
  linvel() { return this.v; }
  angvel() { return this.w; }
  setTranslation(v: Vec) { this.t = { ...v }; }
  setRotation(q: Quat) { this.r = { ...q }; }
  setLinvel(v: Vec) { this.v = { ...v }; }
  setAngvel(v: Vec) { this.w = { ...v }; }
}

class FakeWorld {
  timestep = 1 / 60;
  bodies: FakeBody[] = [];
  colliderList: unknown[] = [];
  freed = false;
  /** Runs on every step, so a test can make the solver "diverge". */
  onStep: (() => void) | null = null;

  colliders = { len: () => this.colliderList.length };

  createRigidBody() {
    const b = new FakeBody();
    this.bodies.push(b);
    return b as unknown as RAPIER.RigidBody;
  }
  createCollider(desc: unknown, body: unknown) {
    const c = { desc, parent: () => body, __c: true };
    this.colliderList.push(c);
    return c as unknown as RAPIER.Collider;
  }
  removeCollider(c: unknown) {
    this.colliderList = this.colliderList.filter((x) => x !== c);
  }
  removeRigidBody(b: unknown) {
    (b as FakeBody).removed = true;
    this.bodies = this.bodies.filter((x) => x !== b);
  }
  step() { this.onStep?.(); }
  free() { this.freed = true; }
}

let lastWorld: FakeWorld;
let trimeshCalls: Array<{ vertices: Float32Array; indices: Uint32Array }> = [];

function fakeRapier(): typeof RAPIER {
  return {
    World: class {
      constructor() {
        lastWorld = new FakeWorld();
        return lastWorld as unknown as RAPIER.World;
      }
    },
    RigidBodyDesc: { fixed: () => ({ kind: 'fixed' }) },
    ColliderDesc: {
      trimesh: (vertices: Float32Array, indices: Uint32Array) => {
        trimeshCalls.push({ vertices, indices });
        return { kind: 'trimesh' };
      },
    },
  } as unknown as typeof RAPIER;
}

async function world(): Promise<PhysicsWorld> {
  __setRapierForTests(fakeRapier());
  return PhysicsWorld.create(1 / 60);
}

function addBody(at = { x: 0, y: 1, z: 0 }) {
  const b = lastWorld.createRigidBody();
  (b as unknown as FakeBody).t = { ...at };
  return b;
}

beforeEach(() => {
  trimeshCalls = [];
});

afterEach(() => {
  __setRapierForTests(null);
});

describe('lazy loading', () => {
  it('reports nothing loaded until something asks', () => {
    __setRapierForTests(null);
    expect(rapierLoaded()).toBe(false);
    __setRapierForTests(fakeRapier());
    expect(rapierLoaded()).toBe(true);
  });

  it('agrees with the clock about how long a step is', async () => {
    const w = await world();
    expect(w.stepSeconds).toBeCloseTo(1 / 60, 9);
    expect(lastWorld.timestep).toBeCloseTo(1 / 60, 9);
  });
});

describe('static geometry', () => {
  it('builds a trimesh from an indexed geometry', async () => {
    const w = await world();
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    g.setIndex([...Array(g.getAttribute('position').count).keys()]);
    w.setStaticGeometry(g);

    expect(w.hasStaticGeometry).toBe(true);
    expect(trimeshCalls).toHaveLength(1);
    expect(trimeshCalls[0].indices.length).toBe(g.getIndex()!.count);
  });

  it('synthesises indices for a non-indexed geometry', async () => {
    const w = await world();
    const g = new THREE.BoxGeometry(1, 1, 1).toNonIndexed();
    expect(g.getIndex()).toBeNull();
    w.setStaticGeometry(g);

    const count = g.getAttribute('position').count;
    expect(trimeshCalls[0].indices.length).toBe(count);
    expect(trimeshCalls[0].indices[0]).toBe(0);
    expect(trimeshCalls[0].indices[count - 1]).toBe(count - 1);
  });

  it('ignores an empty geometry rather than building a degenerate collider', async () => {
    const w = await world();
    w.setStaticGeometry(new THREE.BufferGeometry());
    expect(w.hasStaticGeometry).toBe(false);
    expect(trimeshCalls).toHaveLength(0);
  });

  it('replaces rather than stacks when rebuilt for a new zone', async () => {
    const w = await world();
    const g = new THREE.BoxGeometry(1, 1, 1);
    w.setStaticGeometry(g);
    w.setStaticGeometry(g);
    // Two builds, but only the second collider is still resident.
    expect(trimeshCalls).toHaveLength(2);
    expect(w.stats.colliders).toBe(1);
  });
});

describe('interpolation', () => {
  it('samples between the previous and current step, not ahead of it', async () => {
    const w = await world();
    const b = addBody({ x: 0, y: 0, z: 0 });
    const id = w.track(b);

    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: 10, y: 0, z: 0 }; };
    w.step();

    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();

    w.sample(id, 0, p, q);
    expect(p.x).toBeCloseTo(0, 6);
    w.sample(id, 0.5, p, q);
    expect(p.x).toBeCloseTo(5, 6);
    w.sample(id, 1, p, q);
    expect(p.x).toBeCloseTo(10, 6);
  });

  it('clamps alpha, so a late frame cannot extrapolate past the solver', async () => {
    const w = await world();
    const b = addBody({ x: 0, y: 0, z: 0 });
    const id = w.track(b);
    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: 10, y: 0, z: 0 }; };
    w.step();

    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    w.sample(id, 5, p, q);
    expect(p.x).toBeCloseTo(10, 6);
    w.sample(id, -3, p, q);
    expect(p.x).toBeCloseTo(0, 6);
  });

  it('returns false for a body it does not know', async () => {
    const w = await world();
    expect(w.sample(999, 0.5, new THREE.Vector3(), new THREE.Quaternion())).toBe(false);
  });
});

describe('safety ceilings', () => {
  it('clamps a speed no vehicle in this game can reach', async () => {
    const w = await world();
    const b = addBody();
    w.track(b);

    lastWorld.onStep = () => {
      (b as unknown as FakeBody).v = { x: 4000, y: 0, z: 0 };
    };
    w.step();

    const speed = Math.hypot(...Object.values((b as unknown as FakeBody).v));
    expect(speed).toBeCloseTo(MAX_SPEED, 3);
  });

  it('preserves direction while clamping magnitude', async () => {
    const w = await world();
    const b = addBody();
    w.track(b);
    lastWorld.onStep = () => {
      (b as unknown as FakeBody).v = { x: 300, y: 0, z: 400 };
    };
    w.step();

    const v = (b as unknown as FakeBody).v;
    // The 3-4-5 ratio survives; only the length changes.
    expect(v.z / v.x).toBeCloseTo(400 / 300, 6);
    expect(Math.hypot(v.x, v.y, v.z)).toBeCloseTo(MAX_SPEED, 3);
  });

  it('clamps a spin that would blur the vehicle', async () => {
    const w = await world();
    const b = addBody();
    w.track(b);
    lastWorld.onStep = () => { (b as unknown as FakeBody).w = { x: 0, y: 500, z: 0 }; };
    w.step();
    expect((b as unknown as FakeBody).w.y).toBeCloseTo(MAX_ANGULAR_SPEED, 3);
  });

  it('leaves an ordinary velocity alone', async () => {
    const w = await world();
    const b = addBody();
    w.track(b);
    lastWorld.onStep = () => { (b as unknown as FakeBody).v = { x: 12, y: -1, z: 0 }; };
    w.step();
    expect((b as unknown as FakeBody).v).toEqual({ x: 12, y: -1, z: 0 });
    expect(w.stats.recoveries).toBe(0);
  });
});

describe('rescue', () => {
  it('recovers a body whose transform went non-finite', async () => {
    const w = await world();
    const b = addBody({ x: 3, y: 2, z: 1 });
    const id = w.track(b, { recovery: new THREE.Vector3(7, 5, 9) });

    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: Number.NaN, y: 0, z: 0 }; };
    w.step();

    expect((b as unknown as FakeBody).t).toEqual({ x: 7, y: 5, z: 9 });
    expect((b as unknown as FakeBody).v).toEqual({ x: 0, y: 0, z: 0 });
    expect(w.recoveriesOf(id)).toBe(1);
    expect(w.stats.recoveries).toBe(1);
  });

  it('recovers a body that fell out of the world', async () => {
    const w = await world();
    const b = addBody();
    const id = w.track(b, { recovery: new THREE.Vector3(0, 2, 0) });
    lastWorld.onStep = () => {
      (b as unknown as FakeBody).t = { x: 0, y: WORLD_FLOOR_Y - 10, z: 0 };
    };
    w.step();
    expect(w.recoveriesOf(id)).toBe(1);
    expect((b as unknown as FakeBody).t.y).toBe(2);
  });

  it('falls back to the last good position when no recovery point was given', async () => {
    const w = await world();
    const b = addBody({ x: 4, y: 1, z: 4 });
    const id = w.track(b);
    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: Number.NaN, y: 0, z: 0 }; };
    w.step();
    expect((b as unknown as FakeBody).t).toEqual({ x: 4, y: 1, z: 4 });
    expect(w.recoveriesOf(id)).toBe(1);
  });

  it('does not draw the teleport as a very fast drive', async () => {
    // Both interpolation endpoints must collapse onto the rescue point. If
    // only `curr` moved, the renderer would sweep the vehicle across the map
    // over a single frame.
    const w = await world();
    const b = addBody({ x: 500, y: 1, z: 500 });
    const id = w.track(b, { recovery: new THREE.Vector3(0, 1, 0) });
    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: Number.NaN, y: 0, z: 0 }; };
    w.step();

    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    for (const alpha of [0, 0.5, 1]) {
      w.sample(id, alpha, p, q);
      expect(p.x).toBeCloseTo(0, 6);
      expect(p.z).toBeCloseTo(0, 6);
    }
  });

  it('sets the body upright and still, not merely elsewhere', async () => {
    const w = await world();
    const b = addBody();
    w.track(b, { recovery: new THREE.Vector3(0, 1, 0) });
    lastWorld.onStep = () => {
      const f = b as unknown as FakeBody;
      f.t = { x: Number.NaN, y: 0, z: 0 };
      f.r = { x: 0.7, y: 0, z: 0.7, w: 0 };
      f.w = { x: 9, y: 9, z: 9 };
    };
    w.step();

    expect((b as unknown as FakeBody).r).toEqual({ x: 0, y: 0, z: 0, w: 1 });
    expect((b as unknown as FakeBody).w).toEqual({ x: 0, y: 0, z: 0 });
  });

  it('can move a rescue point as the vehicle drives', async () => {
    const w = await world();
    const b = addBody();
    const id = w.track(b, { recovery: new THREE.Vector3(0, 1, 0) });
    w.setRecoveryPoint(id, new THREE.Vector3(40, 2, 40));

    lastWorld.onStep = () => { (b as unknown as FakeBody).t = { x: Number.NaN, y: 0, z: 0 }; };
    w.step();
    expect((b as unknown as FakeBody).t).toEqual({ x: 40, y: 2, z: 40 });
  });
});

describe('lifecycle', () => {
  it('counts what it is holding', async () => {
    const w = await world();
    w.track(addBody());
    w.track(addBody());
    expect(w.stats.bodies).toBe(2);
    expect(w.stats.steps).toBe(0);
    w.step();
    expect(w.stats.steps).toBe(1);
  });

  it('removes a body from the world when untracked', async () => {
    const w = await world();
    const b = addBody();
    const id = w.track(b);
    w.untrack(id);
    expect(w.stats.bodies).toBe(0);
    expect((b as unknown as FakeBody).removed).toBe(true);
    expect(w.bodyOf(id)).toBeNull();
  });

  it('untracking something already gone is not an error', async () => {
    const w = await world();
    expect(() => w.untrack(123)).not.toThrow();
  });

  it('frees the world on dispose', async () => {
    const w = await world();
    w.setStaticGeometry(new THREE.BoxGeometry(1, 1, 1));
    w.track(addBody());
    w.dispose();
    expect(lastWorld.freed).toBe(true);
    expect(w.stats.bodies).toBe(0);
  });
});
