import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { CameraCollision } from '../src/camera/CameraCollision';
import { makeToon } from '../src/graphics/ToonMaterial';

/**
 * The occluder fade, and the list it now works from.
 *
 * This file exists because of a measurement rather than a bug report. The pass
 * used to raycast the entire scene with `firstHitOnly = false` and then discard
 * every hit whose material was not fadeable — a full all-hits traversal of the
 * terrain's BVH, plus CPU-skinning of every skinned mesh in shot, to find a
 * couple of tree trunks. 10.6 ms a frame in a dev build; 0.65 ms after.
 *
 * What must not be lost in exchange: things that should fade still fade,
 * things that should not are never touched, and a mesh removed from the scene
 * is never raycast again.
 */

/** A mesh at `z`, big enough for a ray down the z axis to hit it. */
function panel(z: number, fadeable: boolean): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(4, 4, 0.2),
    makeToon(0x88aa88, { fadeable, id: fadeable ? `fade${z}` : `solid${z}` }),
  );
  mesh.position.set(0, 0, z);
  mesh.updateMatrixWorld(true);
  return mesh;
}

/** Camera at the origin, player at z = 10, so anything between is an occluder. */
const CAMERA = new THREE.Vector3(0, 0, 0);
const TARGET = new THREE.Vector3(0, 0, 10);

function fadeValue(mesh: THREE.Mesh): number {
  const material = mesh.material as THREE.Material;
  return (material.userData.fade as { value: number } | undefined)?.value ?? 1;
}

describe('the fade candidate list', () => {
  it('collects only meshes whose material can fade', () => {
    const scene = new THREE.Scene();
    scene.add(panel(5, true), panel(6, false), panel(7, true));
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);

    expect(cc.fadeCandidateCount).toBe(2);
  });

  it('finds nothing to test in a scene with no fadeable material', () => {
    const scene = new THREE.Scene();
    scene.add(panel(5, false));
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(0);
  });

  it('does not rebuild the list on every frame', () => {
    const scene = new THREE.Scene();
    scene.add(panel(5, true));
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(1);

    // Added between refreshes. Half a second of staleness is the deal.
    const late = panel(6, true);
    scene.add(late);
    scene.updateMatrixWorld(true);
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(1);

    // And picked up once the interval passes.
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1);
    expect(cc.fadeCandidateCount).toBe(2);
  });

  it('rebuilds immediately when told to', () => {
    const scene = new THREE.Scene();
    scene.add(panel(5, true));
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    scene.add(panel(6, true));
    scene.updateMatrixWorld(true);

    cc.invalidateCandidates();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(2);
  });

  it('drops a mesh detached from the scene rather than raycasting freed geometry', () => {
    // A zone teardown removes and disposes its meshes. One held in a list up
    // to half a second stale would be read after it was freed.
    const scene = new THREE.Scene();
    const tree = panel(5, true);
    scene.add(tree);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(1);

    tree.removeFromParent();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(cc.fadeCandidateCount).toBe(0);
  });

  it('forgets everything when the fades are cleared', () => {
    const scene = new THREE.Scene();
    scene.add(panel(5, true));
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    cc.clearFades();
    expect(cc.fadeCandidateCount).toBe(0);
  });
});

describe('fading', () => {
  it('fades a fadeable mesh standing between the camera and the player', () => {
    const scene = new THREE.Scene();
    const tree = panel(5, true);
    scene.add(tree);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    expect(fadeValue(tree)).toBe(1);

    for (let i = 0; i < 60; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(fadeValue(tree)).toBeLessThan(0.4);
  });

  it('leaves a solid mesh alone, however squarely it is in the way', () => {
    const scene = new THREE.Scene();
    const wall = panel(5, false);
    scene.add(wall);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    for (let i = 0; i < 60; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    // Walking behind a house hides you briefly, by design. Only foliage goes.
    expect(fadeValue(wall)).toBe(1);
  });

  it('restores a mesh once it is no longer in the way', () => {
    const scene = new THREE.Scene();
    const tree = panel(5, true);
    scene.add(tree);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    for (let i = 0; i < 60; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(fadeValue(tree)).toBeLessThan(0.4);

    // Step aside.
    tree.position.x = 40;
    tree.updateMatrixWorld(true);
    for (let i = 0; i < 120; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(fadeValue(tree)).toBe(1);
  });

  it('ignores something behind the player', () => {
    const scene = new THREE.Scene();
    const tree = panel(20, true);
    scene.add(tree);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    for (let i = 0; i < 60; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(fadeValue(tree)).toBe(1);
  });

  it('puts every fade back on clearFades', () => {
    const scene = new THREE.Scene();
    const tree = panel(5, true);
    scene.add(tree);
    scene.updateMatrixWorld(true);

    const cc = new CameraCollision();
    for (let i = 0; i < 60; i++) cc.updateOcclusionFade(CAMERA, TARGET, scene, 1 / 60);
    expect(fadeValue(tree)).toBeLessThan(0.4);

    cc.clearFades();
    expect(fadeValue(tree)).toBe(1);
  });
});
