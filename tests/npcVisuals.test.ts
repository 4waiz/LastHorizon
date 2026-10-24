import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import { NpcVisuals, ambientAppearance } from '../src/npc/NpcVisuals';

/**
 * What the crowd gives back when it goes.
 *
 * Every zone change disposes the population and builds another. three.js gives
 * each skeleton it draws a float texture of bone matrices, and nothing but
 * `Skeleton.dispose` frees it; `NpcVisuals.dispose` never called it, so every
 * journey left one texture per body that had been on screen — about seven a
 * round trip, found by the soak suite.
 *
 * The soak now holds the crowd still while it measures zones, because what a
 * freshly built crowd has drawn by the moment of reading depends on frame
 * timing (tests/long/soak.spec.ts says more). So the crowd's own teardown is
 * asserted here instead, where it can be exact.
 */

/** A two-bone rig with one skinned primitive per palette slot: the player's GLB in miniature. */
function rig(opts: { breakMerge?: boolean } = {}): THREE.Object3D {
  const root = new THREE.Group();
  const hips = new THREE.Bone();
  hips.name = 'hips';
  const spine = new THREE.Bone();
  spine.name = 'spine';
  spine.position.y = 0.5;
  hips.add(spine);
  root.add(hips);
  const skeleton = new THREE.Skeleton([hips, spine]);

  ['skin', 'shirt', 'shorts'].forEach((slot, i) => {
    let g: THREE.BufferGeometry = new THREE.BoxGeometry(0.2, 0.2, 0.2);
    // Mixing indexed and non-indexed parts is one way `mergeGeometries`
    // refuses a set, which is what sends `NpcVisuals` down its fallback.
    if (opts.breakMerge && i === 0) g = g.toNonIndexed();
    const n = g.getAttribute('position').count;
    g.setAttribute('skinIndex', new THREE.Uint16BufferAttribute(new Uint16Array(n * 4), 4));
    const weights = new Float32Array(n * 4);
    for (let v = 0; v < n; v++) weights[v * 4] = 1;
    g.setAttribute('skinWeight', new THREE.Float32BufferAttribute(weights, 4));
    const mesh = new THREE.SkinnedMesh(g, new THREE.MeshBasicMaterial());
    mesh.userData.paletteSlot = slot;
    root.add(mesh);
    mesh.bind(skeleton);
  });
  return root;
}

/** Every skeleton in a body, given a bone texture the way the renderer gives one when it draws it. */
function drawn(root: THREE.Object3D): THREE.DataTexture[] {
  const textures: THREE.DataTexture[] = [];
  const seen = new Set<THREE.Skeleton>();
  root.traverse((o) => {
    const mesh = o as THREE.SkinnedMesh;
    if (!mesh.isSkinnedMesh || seen.has(mesh.skeleton)) return;
    seen.add(mesh.skeleton);
    mesh.skeleton.computeBoneTexture();
    textures.push(mesh.skeleton.boneTexture!);
  });
  return textures;
}

function disposals(textures: THREE.Texture[]): () => number {
  let n = 0;
  for (const t of textures) t.addEventListener('dispose', () => n++);
  return () => n;
}

describe('NpcVisuals.dispose', () => {
  it('frees the bone texture of every body, on screen or pooled', () => {
    const visuals = new NpcVisuals(rig(), []);
    expect(visuals.stats.degraded).toBe(false);

    const onScreen = visuals.acquire(ambientAppearance(1));
    const pooled = visuals.acquire(ambientAppearance(2));
    const textures = [...drawn(onScreen.root), ...drawn(pooled.root)];
    visuals.release(pooled);

    // One merged mesh per body, so one skeleton and one texture each.
    expect(textures).toHaveLength(2);
    const freed = disposals(textures);

    visuals.dispose();
    expect(freed()).toBe(2);
  });

  it('frees every skeleton of an unmerged body, not just the first', () => {
    // A failed merge is reported, and it is the point of this case.
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const visuals = new NpcVisuals(rig({ breakMerge: true }), []);
    error.mockRestore();
    expect(visuals.stats.degraded).toBe(true);

    const body = visuals.acquire(ambientAppearance(3));
    const textures = drawn(body.root);

    // `SkeletonUtils.clone` gives each skinned mesh a skeleton of its own.
    expect(textures).toHaveLength(3);
    const freed = disposals(textures);

    visuals.dispose();
    expect(freed()).toBe(3);
  });
});

describe('NpcVisuals.stats', () => {
  /** The one attribute a variant does not share, so the one whose upload is the variant's. */
  function colourOf(root: THREE.Object3D): THREE.BufferAttribute {
    let colour: THREE.BufferAttribute | null = null;
    root.traverse((o) => {
      const mesh = o as THREE.SkinnedMesh;
      if (mesh.isSkinnedMesh) colour = mesh.geometry.getAttribute('color') as THREE.BufferAttribute;
    });
    return colour!;
  }

  it('counts what the renderer has drawn, not what has been built', () => {
    // The soak's long walk subtracts exactly this from the renderer's totals,
    // so "built but not yet drawn" — a body behind the camera — must not count.
    const visuals = new NpcVisuals(rig(), []);
    const body = visuals.acquire(ambientAppearance(1));
    visuals.acquire(ambientAppearance(2));
    expect(visuals.stats.variants).toBeGreaterThan(0);
    expect(visuals.stats).toMatchObject({ drawnVariants: 0, boneTextures: 0 });

    // What the renderer does on a body's first draw.
    drawn(body.root);
    colourOf(body.root).onUploadCallback();
    // ...and a later re-upload of the same buffer is still one variant.
    colourOf(body.root).onUploadCallback();

    expect(visuals.stats).toMatchObject({ drawnVariants: 1, boneTextures: 1 });
    visuals.dispose();
  });
});
