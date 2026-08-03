import * as THREE from 'three';

/** Release every GPU resource under `root` and detach it from its parent. */
export function disposeObject(root: THREE.Object3D): void {
  const materials = new Set<THREE.Material>();
  const geometries = new Set<THREE.BufferGeometry>();
  const textures = new Set<THREE.Texture>();

  root.traverse((obj) => {
    const mesh = obj as Partial<THREE.Mesh>;
    if (mesh.geometry) geometries.add(mesh.geometry as THREE.BufferGeometry);
    const mat = mesh.material;
    if (mat) {
      if (Array.isArray(mat)) mat.forEach((m) => materials.add(m));
      else materials.add(mat);
    }
  });

  for (const m of materials) {
    for (const value of Object.values(m as unknown as Record<string, unknown>)) {
      if (value instanceof THREE.Texture) textures.add(value);
    }
    m.dispose();
  }
  for (const g of geometries) g.dispose();
  for (const t of textures) t.dispose();

  root.removeFromParent();
}

/** Dispose an array of objects and empty it. */
export function disposeAll(list: THREE.Object3D[]): void {
  for (const o of list) disposeObject(o);
  list.length = 0;
}
