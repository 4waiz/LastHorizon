import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { RoadNetwork, ROAD_HALF_WIDTH, SHOULDER_WIDTH } from '../src/world/RoadSystem';
import { Terrain, naturalHeight, WORLD_SIZE } from '../src/world/Terrain';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import { CharacterMotor, DEFAULT_MOTOR } from '../src/physics/CharacterMotor';

/**
 * These exercise the geometry and physics maths, which need no GPU. Building
 * the terrain grid takes a moment, so the world is constructed once and
 * shared across the suite.
 */

const road = new RoadNetwork(WORLD_SIZE, naturalHeight);
const terrain = new Terrain(road);

describe('naturalHeight', () => {
  it('is deterministic', () => {
    expect(naturalHeight(12.5, -40)).toBe(naturalHeight(12.5, -40));
  });

  it('is continuous — no cliffs between adjacent samples', () => {
    for (let i = 0; i < 200; i++) {
      const x = -120 + i * 1.2;
      const a = naturalHeight(x, -30);
      const b = naturalHeight(x + 0.5, -30);
      expect(Math.abs(a - b)).toBeLessThan(1.5);
    }
  });

  it('climbs toward the far end of the valley', () => {
    expect(naturalHeight(0, -120)).toBeGreaterThan(naturalHeight(0, 120));
  });

  it('rises into the boundary hills', () => {
    expect(naturalHeight(0, -200)).toBeGreaterThan(naturalHeight(0, -60));
  });
});

describe('RoadNetwork', () => {
  it('reports zero-ish distance on the centreline', () => {
    for (const t of [0.2, 0.4, 0.6, 0.8]) {
      const { pos } = road.pointOnMain(t);
      expect(road.sample(pos.x, pos.z).dist).toBeLessThan(1.2);
    }
  });

  it('distance grows as you move off the road', () => {
    const { pos } = road.pointOnMain(0.5);
    const near = road.sample(pos.x, pos.z).dist;
    const mid = road.sample(pos.x + 10, pos.z).dist;
    const far = road.sample(pos.x + 24, pos.z).dist;
    expect(mid).toBeGreaterThan(near);
    expect(far).toBeGreaterThan(mid);
  });

  it('classifies tarmac as hard and open ground as soft', () => {
    const { pos } = road.pointOnMain(0.5);
    expect(road.surfaceHardness(pos.x, pos.z)).toBeGreaterThan(0.9);
    expect(road.surfaceHardness(pos.x + 30, pos.z)).toBeLessThan(0.05);
  });
});

describe('Terrain', () => {
  it('flattens the carriageway across its width', () => {
    // Sampling straight across the road, height must barely vary — a bumpy
    // corridor is what makes a character controller feel drunk.
    const { pos } = road.pointOnMain(0.45);
    const heights: number[] = [];
    for (let o = -ROAD_HALF_WIDTH; o <= ROAD_HALF_WIDTH; o += 0.5) {
      heights.push(terrain.heightAt(pos.x + o, pos.z));
    }
    const spread = Math.max(...heights) - Math.min(...heights);
    expect(spread).toBeLessThan(0.35);
  });

  it('runs smoothly along the road', () => {
    let worst = 0;
    for (let t = 0.15; t < 0.85; t += 0.01) {
      const a = road.pointOnMain(t).pos;
      const b = road.pointOnMain(t + 0.005).pos;
      const d = Math.hypot(b.x - a.x, b.z - a.z);
      if (d < 0.1) continue;
      const grade = Math.abs(terrain.heightAt(b.x, b.z) - terrain.heightAt(a.x, a.z)) / d;
      worst = Math.max(worst, grade);
    }
    // Well under the 50 degree (1.19) walkable slope limit.
    expect(worst).toBeLessThan(0.35);
  });

  it('blends back to natural ground away from the road', () => {
    const { pos } = road.pointOnMain(0.5);
    const x = pos.x + ROAD_HALF_WIDTH + SHOULDER_WIDTH + 40;
    expect(terrain.heightAt(x, pos.z)).toBeCloseTo(naturalHeight(x, pos.z), 0);
  });

  it('bilinear lookup is continuous', () => {
    for (let i = 0; i < 300; i++) {
      const x = -100 + i * 0.6;
      const a = terrain.heightAt(x, 20);
      const b = terrain.heightAt(x + 0.2, 20);
      expect(Math.abs(a - b)).toBeLessThan(0.6);
    }
  });

  it('normals point upward on walkable ground', () => {
    const { pos } = road.pointOnMain(0.5);
    expect(terrain.normalAt(pos.x, pos.z).y).toBeGreaterThan(0.95);
    expect(terrain.slopeAt(pos.x, pos.z)).toBeLessThan(0.05);
  });

  it('knows its own bounds', () => {
    expect(terrain.isInside(0, 0)).toBe(true);
    expect(terrain.isInside(WORLD_SIZE, 0)).toBe(false);
    expect(terrain.isInside(0, -WORLD_SIZE)).toBe(false);
  });
});

describe('CharacterMotor against a BVH', () => {
  /** A flat slab plus one wall, enough to test grounding and blocking. */
  function makeWorld(): CollisionWorld {
    const floor = new THREE.Mesh(new THREE.BoxGeometry(60, 1, 60));
    floor.position.set(0, -0.5, 0);
    floor.updateMatrixWorld(true);

    const wall = new THREE.Mesh(new THREE.BoxGeometry(1, 6, 20));
    wall.position.set(6, 3, 0);
    wall.updateMatrixWorld(true);

    const world = new CollisionWorld();
    world.build([floor, wall]);
    return world;
  }

  const stepFor = (motor: CharacterMotor, world: CollisionWorld, seconds: number) => {
    const dt = 1 / 60;
    for (let i = 0; i < Math.round(seconds / dt); i++) motor.update(dt, world);
  };

  it('builds a collider', () => {
    const world = makeWorld();
    expect(world.ready).toBe(true);
    expect(world.triangleCount).toBeGreaterThan(0);
    world.dispose();
  });

  it('falls and settles on the ground without sinking', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 5, 0);
    stepFor(motor, world, 2);
    expect(motor.grounded).toBe(true);
    expect(motor.position.y).toBeCloseTo(0, 2);
    world.dispose();
  });

  it('jumps, rises, and returns to the ground', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 0.1, 0);
    stepFor(motor, world, 0.5);

    motor.jump(6.35);
    let peak = motor.position.y;
    for (let i = 0; i < 40; i++) {
      motor.update(1 / 60, world);
      peak = Math.max(peak, motor.position.y);
    }
    expect(peak).toBeGreaterThan(0.7);

    stepFor(motor, world, 2);
    expect(motor.grounded).toBe(true);
    expect(motor.position.y).toBeCloseTo(0, 2);
    world.dispose();
  });

  it('cannot walk through a wall', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 0.1, 0);
    stepFor(motor, world, 0.5);
    for (let i = 0; i < 240; i++) {
      motor.velocity.x = 5;
      motor.update(1 / 60, world);
    }
    // Wall face is at x = 5.5; capsule radius keeps us short of it.
    expect(motor.position.x).toBeLessThan(5.5);
    expect(motor.position.x).toBeGreaterThan(4.5);
    world.dispose();
  });

  it('does not tunnel through the wall at high speed', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 0.1, 0);
    stepFor(motor, world, 0.5);
    for (let i = 0; i < 60; i++) {
      motor.velocity.x = 60; // far beyond run speed
      motor.update(1 / 30, world); // and a bad frame time
    }
    expect(motor.position.x).toBeLessThan(5.5);
    world.dispose();
  });

  it('reports a landing impact after a real fall', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 9, 0);
    let sawLanding = false;
    for (let i = 0; i < 200; i++) {
      motor.update(1 / 60, world);
      if (motor.justLanded) {
        sawLanding = true;
        expect(motor.lastImpactSpeed).toBeGreaterThan(4);
        break;
      }
    }
    expect(sawLanding).toBe(true);
    world.dispose();
  });

  it('accumulates air time and clears it on contact', () => {
    const world = makeWorld();
    const motor = new CharacterMotor({ ...DEFAULT_MOTOR });
    motor.teleport(0, 6, 0);
    stepFor(motor, world, 0.3);
    expect(motor.airTime).toBeGreaterThan(0.2);
    stepFor(motor, world, 3);
    expect(motor.airTime).toBe(0);
    world.dispose();
  });
});
