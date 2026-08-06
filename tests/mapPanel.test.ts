import { describe, it, expect } from 'vitest';
import type { MinimapData } from '../src/ui/Minimap';
import {
  MAP_LEGEND, MAX_SCALE, MIN_SCALE,
  clampScale, fitToData, mapToWorld, scaleBarMetres, worldToMap, zoomAbout,
  type MapView,
} from '../src/ui/MapPanel';

const W = 800;
const H = 600;
const view = (over: Partial<MapView> = {}): MapView => ({
  centreX: 0, centreZ: 0, scale: 2, ...over,
});

const data: MinimapData = {
  roads: [[{ x: -50, z: -50 }, { x: 50, z: 50 }]],
  buildings: [{ x: 20, z: -30, r: 4 }],
};

describe('projection', () => {
  it('puts the view centre at the canvas centre', () => {
    const s = worldToMap({ x: 10, z: -4 }, view({ centreX: 10, centreZ: -4 }), W, H);
    expect(s.x).toBeCloseTo(W / 2, 6);
    expect(s.y).toBeCloseTo(H / 2, 6);
  });

  it('is north-up: +Z world goes up the screen', () => {
    // The radar rotates with the player; a map that did the same would be a
    // compass. North must stay at the top.
    const north = worldToMap({ x: 0, z: 100 }, view(), W, H);
    const south = worldToMap({ x: 0, z: -100 }, view(), W, H);
    expect(north.y).toBeLessThan(H / 2);
    expect(south.y).toBeGreaterThan(H / 2);
  });

  it('puts +X world to the right', () => {
    expect(worldToMap({ x: 50, z: 0 }, view(), W, H).x).toBeGreaterThan(W / 2);
  });

  it('scales distance by the zoom', () => {
    const near = worldToMap({ x: 10, z: 0 }, view({ scale: 1 }), W, H);
    const far = worldToMap({ x: 10, z: 0 }, view({ scale: 4 }), W, H);
    expect(far.x - W / 2).toBeCloseTo((near.x - W / 2) * 4, 6);
  });

  it('round trips through screen space', () => {
    const v = view({ centreX: 30, centreZ: -12, scale: 1.7 });
    for (const p of [{ x: 0, z: 0 }, { x: 120, z: -80 }, { x: -45, z: 66 }]) {
      const back = mapToWorld(worldToMap(p, v, W, H), v, W, H);
      expect(back.x).toBeCloseTo(p.x, 6);
      expect(back.z).toBeCloseTo(p.z, 6);
    }
  });
});

describe('zoom', () => {
  it('stays within its limits', () => {
    expect(clampScale(1000)).toBe(MAX_SCALE);
    expect(clampScale(0)).toBe(MIN_SCALE);
    expect(clampScale(Number.NaN)).toBe(1);
  });

  it('keeps the world point under the cursor still', () => {
    // Zooming about the centre walks whatever you were looking at off the
    // edge, which is what makes a map feel like a slideshow.
    const v = view({ centreX: 10, centreZ: 5, scale: 1 });
    const anchor = { x: 700, y: 120 };
    const before = mapToWorld(anchor, v, W, H);

    const zoomed = zoomAbout(v, anchor, 2, W, H);
    const after = mapToWorld(anchor, zoomed, W, H);

    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.z).toBeCloseTo(before.z, 6);
  });

  it('actually changes the scale', () => {
    const v = view({ scale: 1 });
    expect(zoomAbout(v, { x: 400, y: 300 }, 2, W, H).scale).toBeCloseTo(2, 6);
    expect(zoomAbout(v, { x: 400, y: 300 }, 0.5, W, H).scale).toBeCloseTo(0.5, 6);
  });

  it('returns the same view when already at the limit', () => {
    const v = view({ scale: MAX_SCALE });
    expect(zoomAbout(v, { x: 0, y: 0 }, 4, W, H)).toBe(v);
  });

  it('does not drift the centre when zooming about the middle', () => {
    const v = view({ centreX: 8, centreZ: -3, scale: 1 });
    const z = zoomAbout(v, { x: W / 2, y: H / 2 }, 2, W, H);
    expect(z.centreX).toBeCloseTo(8, 6);
    expect(z.centreZ).toBeCloseTo(-3, 6);
  });
});

describe('framing the world', () => {
  it('centres on what there is to see', () => {
    const v = fitToData(data, W, H);
    expect(v.centreX).toBeCloseTo((-50 + 50) / 2, 6);
    expect(v.centreZ).toBeCloseTo((-50 + 50) / 2, 6);
  });

  it('fits everything inside the canvas', () => {
    const v = fitToData(data, W, H);
    for (const p of [...data.roads.flat(), ...data.buildings]) {
      const s = worldToMap(p, v, W, H);
      expect(s.x).toBeGreaterThanOrEqual(0);
      expect(s.x).toBeLessThanOrEqual(W);
      expect(s.y).toBeGreaterThanOrEqual(0);
      expect(s.y).toBeLessThanOrEqual(H);
    }
  });

  it('survives a map with nothing on it', () => {
    const v = fitToData({ roads: [], buildings: [] }, W, H);
    expect(Number.isFinite(v.scale)).toBe(true);
    expect(v.scale).toBeGreaterThan(0);
  });

  it('never exceeds the zoom limits, however small the world', () => {
    const tiny = fitToData({ roads: [[{ x: 0, z: 0 }, { x: 0.1, z: 0.1 }]], buildings: [] }, W, H);
    expect(tiny.scale).toBeLessThanOrEqual(MAX_SCALE);
    const huge = fitToData({ roads: [[{ x: -9000, z: -9000 }, { x: 9000, z: 9000 }]], buildings: [] }, W, H);
    expect(huge.scale).toBeGreaterThanOrEqual(MIN_SCALE);
  });
});

describe('scale bar', () => {
  it('reads as a round number a person would say', () => {
    const nice = [10, 20, 25, 50, 100, 200, 250, 500, 1000];
    for (const scale of [0.4, 0.8, 1.5, 3, 5.5]) {
      expect(nice).toContain(scaleBarMetres(view({ scale })));
    }
  });

  it('covers more ground as the map zooms out', () => {
    expect(scaleBarMetres(view({ scale: 0.5 }))).toBeGreaterThan(
      scaleBarMetres(view({ scale: 4 })),
    );
  });
});

describe('legend', () => {
  it('explains every symbol the map draws', () => {
    const keys = MAP_LEGEND.map((l) => l.key);
    for (const k of ['road', 'building', 'keepsake', 'found', 'vehicle', 'player']) {
      expect(keys).toContain(k);
    }
  });

  it('gives every entry a colour and a label', () => {
    for (const entry of MAP_LEGEND) {
      expect(entry.colour).toMatch(/^#[0-9a-f]{6}$/i);
      expect(entry.label.length).toBeGreaterThan(2);
    }
  });

  it('has no duplicate keys', () => {
    expect(new Set(MAP_LEGEND.map((l) => l.key)).size).toBe(MAP_LEGEND.length);
  });
});
