import { describe, it, expect, beforeEach } from 'vitest';
import {
  EMPTY_OVERLAY,
  Minimap,
  type MinimapData,
  type MinimapOverlay,
} from '../src/ui/Minimap';
import * as THREE from 'three';

/**
 * The radar's live layer: the police search area and the markers.
 *
 * **jsdom has no 2D canvas context.** The first version of this file relied
 * on one and every "does not throw" case passed without executing a single
 * line of the draw — `update` returns early on a null context, so the whole
 * suite was green and vacuous. The two cases that counted calls were the only
 * ones that noticed, by failing.
 *
 * So the context is stubbed with a recorder. That makes the drawing itself
 * testable rather than merely survivable: what shape a marker kind produces,
 * whether the search circle is drawn, and whether a redraw happens at all.
 */

interface Call {
  readonly op: string;
  readonly args: readonly unknown[];
}

/**
 * A 2D context that remembers what it was asked to do.
 *
 * Every method is a recorder and every property a plain field, which is
 * enough for `Minimap.draw`: it draws, it never measures or reads back.
 */
function recorder(): { ctx: CanvasRenderingContext2D; calls: Call[] } {
  const calls: Call[] = [];
  const ops = [
    'clearRect', 'save', 'restore', 'beginPath', 'arc', 'clip', 'fillRect',
    'translate', 'rotate', 'scale', 'stroke', 'fill', 'moveTo', 'lineTo',
    'rect', 'closePath', 'setLineDash',
  ];
  const ctx: Record<string, unknown> = {
    fillStyle: '', strokeStyle: '', lineWidth: 0, globalAlpha: 1,
    lineJoin: '', lineCap: '',
  };
  for (const op of ops) {
    ctx[op] = (...args: unknown[]) => {
      // Style is a property, so record it alongside the call or a `fill` says
      // nothing about *what* was filled.
      calls.push({ op, args: [...args, ctx.fillStyle, ctx.strokeStyle] });
    };
  }
  return { ctx: ctx as unknown as CanvasRenderingContext2D, calls };
}

let calls: Call[] = [];

const data: MinimapData = {
  roads: [[{ x: -10, z: -10 }, { x: 10, z: 10 }]],
  buildings: [{ x: 4, z: 4, r: 3 }],
};

const at = new THREE.Vector3(0, 0, 0);

function mountCanvas(withContext = true): void {
  document.body.innerHTML = '<canvas id="minimap" width="132" height="132"></canvas>';
  if (!withContext) return;
  const rec = recorder();
  calls = rec.calls;
  const el = document.getElementById('minimap') as HTMLCanvasElement;
  // Through `unknown`: the real signature is four overloads and the stub only
  // ever answers the '2d' one, which is the only one `Minimap` asks for.
  el.getContext = (() => rec.ctx) as unknown as HTMLCanvasElement['getContext'];
}

const opsOf = (name: string) => calls.filter((c) => c.op === name);
const usedStyle = (style: string) =>
  calls.some((c) => c.args.some((a) => typeof a === 'string' && a.includes(style)));

beforeEach(() => mountCanvas());

describe('the overlay supplier', () => {
  it('defaults to nothing, so a two-argument caller still works', () => {
    const m = new Minimap(data, () => []);
    m.update(1, at, 0);
    // It really drew: the field is cleared and filled every redraw.
    expect(opsOf('clearRect')).toHaveLength(1);
  });

  it('is asked for on a redraw', () => {
    let asked = 0;
    const m = new Minimap(data, () => [], () => {
      asked++;
      return EMPTY_OVERLAY;
    });
    m.update(1, at, 0);
    expect(asked).toBe(1);
  });

  /**
   * The radar redraws at 20 Hz, not 60. The overlay is rebuilt each time it
   * is asked for — it walks the garage and reads `Heat.belief` — so being
   * asked on every frame would be triple the work for a readout nobody can
   * see change that fast.
   */
  it('is not asked for on a frame that does not redraw', () => {
    let asked = 0;
    const m = new Minimap(data, () => [], () => {
      asked++;
      return EMPTY_OVERLAY;
    });
    m.update(1 / 240, at, 0);
    expect(asked).toBe(0);
    expect(opsOf('clearRect')).toHaveLength(0);
  });

  it('throttles to roughly twenty a second', () => {
    let asked = 0;
    const m = new Minimap(data, () => [], () => {
      asked++;
      return EMPTY_OVERLAY;
    });
    for (let i = 0; i < 60; i++) m.update(1 / 60, at, 0);
    expect(asked).toBeGreaterThan(15);
    expect(asked).toBeLessThan(25);
  });
});

describe('the police search area', () => {
  const withSearch = (search: MinimapOverlay['search']) =>
    new Minimap(data, () => [], () => ({ ...EMPTY_OVERLAY, search }));

  it('is not drawn when nobody is looking', () => {
    withSearch(null).update(1, at, 0);
    expect(usedStyle('180, 88, 70')).toBe(false);
    expect(opsOf('setLineDash')).toHaveLength(0);
  });

  it('is drawn, dashed, when they are', () => {
    withSearch({ x: 5, z: 5, radius: 20 }).update(1, at, 0);
    expect(usedStyle('180, 88, 70'), 'the search circle was never filled').toBe(true);
    // Dashed and then explicitly un-dashed, or every later stroke inherits it.
    expect(opsOf('setLineDash')).toHaveLength(2);
    expect(opsOf('setLineDash')[1].args[0]).toEqual([]);
  });

  /**
   * Culled on the *circle*, not its centre. The useful case is standing
   * outside an area that is still on screen — cull by centre and the ring you
   * are avoiding disappears exactly when it matters.
   */
  it('still draws when its centre is off the rim but its edge is not', () => {
    withSearch({ x: 100, z: 0, radius: 60 }).update(1, at, 0);
    expect(usedStyle('180, 88, 70')).toBe(true);
  });

  it('is culled when the whole circle is far away', () => {
    withSearch({ x: 5000, z: 5000, radius: 10 }).update(1, at, 0);
    expect(usedStyle('180, 88, 70')).toBe(false);
  });

  it('survives a zero radius, which a fresh sighting produces', () => {
    expect(() => withSearch({ x: 0, z: 0, radius: 0 }).update(1, at, 0)).not.toThrow();
  });
});

describe('markers carry meaning in their shape', () => {
  const withMarkers = (markers: MinimapOverlay['markers']) =>
    new Minimap(data, () => [], () => ({ ...EMPTY_OVERLAY, markers }));

  /**
   * Shape, not only colour. A radar is 132 px of small marks and colour is
   * the one channel a colour-blind player does not have — the same argument
   * the Heat numerals setting makes.
   */
  it('draws a vehicle as a rectangle', () => {
    withMarkers([{ x: 1, z: 1, kind: 'vehicle' }]).update(1, at, 0);
    // One rect for the marker; buildings use `rect` too, so count the rise.
    const withoutMarker = (() => {
      mountCanvas();
      new Minimap(data, () => []).update(1, at, 0);
      return opsOf('rect').length;
    })();
    mountCanvas();
    withMarkers([{ x: 1, z: 1, kind: 'vehicle' }]).update(1, at, 0);
    expect(opsOf('rect').length).toBe(withoutMarker + 1);
  });

  it('draws the aeroplane as a triangle and an objective as a diamond', () => {
    withMarkers([{ x: 1, z: 1, kind: 'aircraft' }]).update(1, at, 0);
    const triangle = opsOf('lineTo').length;

    mountCanvas();
    withMarkers([{ x: 1, z: 1, kind: 'objective' }]).update(1, at, 0);
    const diamond = opsOf('lineTo').length;

    // A diamond has one more edge than a triangle. Different shapes, proven
    // rather than asserted in a comment.
    expect(diamond).toBe(triangle + 1);
  });

  it('draws a keepsake marker as a circle', () => {
    mountCanvas();
    new Minimap(data, () => []).update(1, at, 0);
    const base = opsOf('arc').length;

    mountCanvas();
    withMarkers([{ x: 1, z: 1, kind: 'keepsake' }]).update(1, at, 0);
    expect(opsOf('arc').length).toBe(base + 1);
  });

  it('culls a marker beyond the rim', () => {
    mountCanvas();
    new Minimap(data, () => []).update(1, at, 0);
    const base = opsOf('rect').length;

    mountCanvas();
    withMarkers([{ x: 90_000, z: -90_000, kind: 'vehicle' }]).update(1, at, 0);
    expect(opsOf('rect').length).toBe(base);
  });

  it('draws every kind at once without complaint', () => {
    expect(() =>
      withMarkers([
        { x: 1, z: 1, kind: 'vehicle' },
        { x: 2, z: 2, kind: 'aircraft' },
        { x: 3, z: 3, kind: 'objective' },
        { x: 4, z: 4, kind: 'keepsake' },
      ]).update(1, at, 0),
    ).not.toThrow();
  });
});

describe('when there is no canvas', () => {
  it('does nothing rather than throwing', () => {
    // `Minimap` looks itself up by id. A test harness, a stripped page or a
    // future layout change can all mean it is not there, and the frame loop
    // must not care.
    document.body.innerHTML = '';
    const m = new Minimap(data, () => []);
    expect(() => m.update(1, at, 0)).not.toThrow();
    expect(() => m.setVisible(true)).not.toThrow();
    expect(() => m.setData(data)).not.toThrow();
  });
});
