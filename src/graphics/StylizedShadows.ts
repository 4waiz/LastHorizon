import * as THREE from 'three';
import { saturate } from '../utils/MathUtils';

/**
 * A soft contact shadow that rides under the character.
 *
 * The directional shadow map alone leaves the character looking slightly
 * detached when it stands on a bright surface — the penumbra is too wide at
 * the map resolutions we can afford. A small radial blob under the feet,
 * aligned to the ground normal and fading with air time, restores the
 * grounding cue for almost nothing.
 */

function radialTexture(): THREE.Texture {
  const s = 128;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  const g = ctx.createRadialGradient(s / 2, s / 2, 0, s / 2, s / 2, s / 2);
  g.addColorStop(0, 'rgba(0,0,0,0.62)');
  g.addColorStop(0.45, 'rgba(0,0,0,0.34)');
  g.addColorStop(0.78, 'rgba(0,0,0,0.09)');
  g.addColorStop(1, 'rgba(0,0,0,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, s, s);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class ContactShadow {
  readonly mesh: THREE.Mesh;
  private readonly material: THREE.MeshBasicMaterial;
  private readonly texture: THREE.Texture;
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly quat = new THREE.Quaternion();

  constructor(radius = 0.62) {
    this.texture = radialTexture();
    this.material = new THREE.MeshBasicMaterial({
      map: this.texture,
      transparent: true,
      depthWrite: false,
      opacity: 0.9,
      color: 0x5a5348,
      blending: THREE.NormalBlending,
      fog: false,
    });
    const geo = new THREE.PlaneGeometry(radius * 2, radius * 2);
    geo.rotateX(-Math.PI / 2);
    this.mesh = new THREE.Mesh(geo, this.material);
    this.mesh.name = 'ContactShadow';
    this.mesh.renderOrder = 2;
    this.mesh.frustumCulled = false;
  }

  /**
   * @param groundY  surface height under the character, or null when airborne
   * @param airTime  seconds since the character left the ground
   * @param strength scene-wide multiplier, dimmed at night
   */
  update(
    position: THREE.Vector3,
    groundNormal: THREE.Vector3,
    groundY: number | null,
    airTime: number,
    strength: number,
  ): void {
    if (groundY === null || strength <= 0.01) {
      this.mesh.visible = false;
      return;
    }
    this.mesh.visible = true;
    this.mesh.position.set(position.x, groundY + 0.022, position.z);

    // Lie flush with the slope so the blob doesn't float off a hillside.
    this.quat.setFromUnitVectors(this.up, groundNormal);
    this.mesh.quaternion.copy(this.quat);

    // Shrink and fade as the character rises — a jump should read as a jump.
    const lift = saturate(airTime * 1.9);
    const spread = 1 + lift * 0.85;
    this.mesh.scale.setScalar(spread);
    this.material.opacity = (0.9 - lift * 0.62) * strength;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.material.dispose();
    this.texture.dispose();
  }
}
