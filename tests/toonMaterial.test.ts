import { describe, it, expect } from 'vitest';
import * as THREE from 'three';
import { toonFromImported } from '../src/graphics/ToonMaterial';

/**
 * Regression cover for the "detached roof" bug.
 *
 * `leaf_*`, `bush*` and `palm_frond` are palette *colour* names in the Blender
 * kit, not semantic foliage markers. HouseLarge's dormer window box paints its
 * five 24 cm plants `leaf_mid`; the interior paints the bed blanket, book
 * spines, pens and framed pictures `leaf_teal` / `leaf_mid`.
 *
 * Matching on the name alone gave all of those the tree-canopy wind shader.
 * Because the sway mask is keyed off object-space height against a 4.5 m
 * reference, the dormer plants — sitting ~6.5 m up — swung with more than
 * twice a full tree's amplitude and detached from the building near the roof.
 *
 * Wind is now opt-in and only the vegetation path asks for it.
 */

const kindOf = (m: THREE.Material) => (m.userData as { kind?: string }).kind;
const isFadeable = (m: THREE.Material) =>
  (m.userData as { fade?: unknown }).fade !== undefined;

function imported(name: string, color = 0x4c8f3a): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ name, color });
}

describe('toonFromImported — wind is opt-in', () => {
  it('does not give a building a wind material just because it is named leaf_*', () => {
    const m = toonFromImported(imported('leaf_mid'), 'HouseLarge');
    expect(kindOf(m)).toBe('solid');
    expect(isFadeable(m)).toBe(false);
  });

  it('does not sway interior furniture painted with a leaf_* palette colour', () => {
    for (const matName of ['leaf_teal', 'leaf_mid']) {
      const m = toonFromImported(imported(matName, 0x2f6f6a), 'RoomInterior');
      expect(kindOf(m)).toBe('solid');
      expect(isFadeable(m)).toBe(false);
    }
  });

  it('still gives real vegetation the foliage wind material', () => {
    const m = toonFromImported(imported('leaf_mid'), 'TreeBig', { allowWind: true });
    expect(kindOf(m)).toBe('foliage');
    expect(isFadeable(m)).toBe(true);
  });

  it('matches foliage on the model hint as well as the material name', () => {
    const m = toonFromImported(imported('generic', 0x3d7a2f), 'BushA', { allowWind: true });
    expect(kindOf(m)).toBe('foliage');
  });

  it('keeps palm fronds double sided, but only on the vegetation path', () => {
    const veg = toonFromImported(imported('palm_frond', 0x6aa84f), 'Palm', { allowWind: true });
    expect(veg.side).toBe(THREE.DoubleSide);

    const prop = toonFromImported(imported('palm_frond', 0x6aa84f), 'HouseLarge');
    expect(prop.side).not.toBe(THREE.DoubleSide);
    expect(kindOf(prop)).toBe('solid');
  });

  it('only fades trunks that came through the vegetation path', () => {
    expect(isFadeable(toonFromImported(imported('trunk_brown', 0x6b4a2f), 'TreeMed', { allowWind: true }))).toBe(true);
    // The same palette colour is used for interior woodwork.
    expect(isFadeable(toonFromImported(imported('trunk_brown', 0x6b4a2f), 'RoomInterior'))).toBe(false);
  });

  it('leaves rocks solid even on the vegetation path', () => {
    const m = toonFromImported(imported('rock_grey', 0x8a8a8a), 'RockA', { allowWind: true });
    expect(kindOf(m)).toBe('solid');
    expect(isFadeable(m)).toBe(false);
  });

  it('still routes lamp glass to the lamp material', () => {
    const m = toonFromImported(imported('lamp_glass', 0xffd9a0), 'Streetlight');
    expect((m.userData as { lampKey?: string }).lampKey).toBeDefined();
  });
});
