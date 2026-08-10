import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { DEFAULT_CAMERA, ThirdPersonCamera } from '../src/camera/ThirdPersonCamera';
import { CollisionWorld } from '../src/physics/CollisionWorld';
import type { InputManager } from '../src/core/InputManager';

/**
 * Aim mode: the boom, the shoulder and the sensitivity.
 *
 * The Phase 9 brief asks for third-person aim with shoulder swap, aim
 * sensitivity and camera collision. Three of those four are arithmetic on a
 * class with no scene in it, so they are testable here rather than only by
 * looking at a screenshot and deciding it seems about right.
 *
 * `CameraCollision` already has its own file; what this checks is that the
 * shorter aiming boom still goes through the same probe, because "the camera
 * is closer so it cannot clip" is exactly the assumption that puts a camera
 * through a doorframe.
 */

/** Just enough InputManager for the camera. Nothing else is read. */
function look(dx = 0, dy = 0): InputManager {
  let spent = false;
  return {
    consumeLook: () => {
      if (spent) return { x: 0, y: 0 };
      spent = true;
      return { x: dx, y: dy };
    },
    consumeZoom: () => 0,
  } as unknown as InputManager;
}

const EMPTY = new CollisionWorld();
const SCENE = new THREE.Scene();
const TARGET = new THREE.Vector3(0, 0, 0);

/** Run enough frames for the aim blend to settle. */
function settle(cam: ThirdPersonCamera, frames = 240): void {
  for (let i = 0; i < frames; i++) cam.update(1 / 60, TARGET, look(), EMPTY, SCENE);
}

describe('aim mode', () => {
  it('starts off, so a player who never draws anything never sees it', () => {
    const cam = new ThirdPersonCamera(16 / 9);
    expect(cam.isAiming).toBe(false);
    expect(cam.shoulderSide).toBe(1);
  });

  it('pulls the boom in, and lets it back out again', () => {
    const cam = new ThirdPersonCamera(16 / 9);
    settle(cam);
    const relaxed = cam.camera.position.distanceTo(TARGET);

    cam.setAiming(true);
    settle(cam);
    const aimed = cam.camera.position.distanceTo(TARGET);

    expect(aimed, 'aiming brings the camera closer').toBeLessThan(relaxed);
    expect(aimed).toBeLessThan(DEFAULT_CAMERA.distance);

    cam.setAiming(false);
    settle(cam);
    // Back to the framing the player had, not to some third value.
    expect(cam.camera.position.distanceTo(TARGET)).toBeCloseTo(relaxed, 1);
  });

  it('swaps the shoulder, and the camera actually moves across', () => {
    const cam = new ThirdPersonCamera(16 / 9);
    cam.setAiming(true);
    settle(cam);
    const right = cam.camera.position.clone();

    cam.swapShoulder();
    expect(cam.shoulderSide).toBe(-1);
    settle(cam);

    // Mirrored about the view axis, so the two positions must differ by more
    // than the easing tolerance in the sideways direction.
    expect(cam.camera.position.distanceTo(right)).toBeGreaterThan(
      DEFAULT_CAMERA.aimShoulderOffset,
    );

    cam.swapShoulder();
    expect(cam.shoulderSide).toBe(1);
    settle(cam);
    expect(cam.camera.position.distanceTo(right)).toBeLessThan(0.05);
  });

  it('turns more slowly while aiming, for the same stick movement', () => {
    const free = new ThirdPersonCamera(16 / 9);
    settle(free);
    const before = free.yaw;
    free.update(1 / 60, TARGET, look(100, 0), EMPTY, SCENE);
    const freeTurn = Math.abs(free.yaw - before);

    const aimed = new ThirdPersonCamera(16 / 9);
    aimed.setAiming(true);
    settle(aimed);
    const aimedBefore = aimed.yaw;
    aimed.update(1 / 60, TARGET, look(100, 0), EMPTY, SCENE);
    const aimedTurn = Math.abs(aimed.yaw - aimedBefore);

    expect(aimedTurn).toBeLessThan(freeTurn);
    expect(aimedTurn / freeTurn).toBeCloseTo(DEFAULT_CAMERA.aimSensitivity, 1);
  });

  it('still clamps pitch while aiming', () => {
    const cam = new ThirdPersonCamera(16 / 9);
    cam.setAiming(true);
    settle(cam);
    for (let i = 0; i < 50; i++) {
      cam.update(1 / 60, TARGET, look(0, 500), EMPTY, SCENE);
    }
    expect(cam.pitch).toBeLessThanOrEqual(DEFAULT_CAMERA.maxPitch + 1e-6);
  });

  it('is a blend rather than a cut, so one frame of aiming is not a jump', () => {
    const cam = new ThirdPersonCamera(16 / 9);
    settle(cam);
    const relaxed = cam.camera.position.distanceTo(TARGET);

    cam.setAiming(true);
    cam.update(1 / 60, TARGET, look(), EMPTY, SCENE);
    const oneFrame = cam.camera.position.distanceTo(TARGET);

    // Moved toward the aim distance, but nowhere near all the way.
    expect(oneFrame).toBeLessThan(relaxed);
    expect(oneFrame).toBeGreaterThan(DEFAULT_CAMERA.aimDistance + 1);
  });
});
