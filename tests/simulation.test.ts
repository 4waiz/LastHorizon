import { describe, it, expect, vi } from 'vitest';
import { SimulationClock } from '../src/core/SimulationClock';
import { DisposalRegistry } from '../src/core/DisposalRegistry';
import { ZoneManager, type ZoneBuilder } from '../src/world/zones/ZoneManager';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';

describe('SimulationClock', () => {
  it('emits whole steps of a constant size', () => {
    const c = new SimulationClock({ stepSeconds: 1 / 60 });
    const t = c.advance(1 / 60);
    expect(t.steps).toBe(1);
    expect(t.dt).toBeCloseTo(1 / 60, 10);
  });

  it('carries the remainder rather than losing or inventing time', () => {
    const c = new SimulationClock({ stepSeconds: 0.1 });
    expect(c.advance(0.25).steps).toBe(2);
    expect(c.alpha).toBeCloseTo(0.5, 6);
    expect(c.advance(0.05).steps).toBe(1);
    expect(c.simulatedSeconds).toBeCloseTo(0.3, 6);
  });

  it('accumulates a sub-step frame instead of dropping it', () => {
    const c = new SimulationClock({ stepSeconds: 0.1 });
    expect(c.advance(0.04).steps).toBe(0);
    expect(c.advance(0.04).steps).toBe(0);
    expect(c.advance(0.04).steps).toBe(1);
  });

  it('clamps a long stall rather than spiralling', () => {
    const c = new SimulationClock({ stepSeconds: 1 / 60, maxStepsPerFrame: 5 });
    const t = c.advance(10); // a ten-second freeze
    expect(t.steps).toBe(5);
    expect(t.clamped).toBe(true);
    // The backlog is discarded, not owed to the next frame.
    expect(c.advance(0).steps).toBe(0);
    expect(c.alpha).toBe(0);
  });

  it('runs no steps while paused, and does not replay the pause on resume', () => {
    const c = new SimulationClock({ stepSeconds: 0.1 });
    c.pause();
    expect(c.advance(5).steps).toBe(0);
    expect(c.isPaused).toBe(true);
    c.resume();
    expect(c.advance(0.05).steps).toBe(0);
    expect(c.simulatedSeconds).toBe(0);
  });

  it('ignores nonsense input rather than trusting it', () => {
    const c = new SimulationClock();
    expect(c.advance(-1).steps).toBe(0);
    expect(c.advance(Number.NaN).steps).toBe(0);
    expect(c.advance(Number.POSITIVE_INFINITY).steps).toBe(0);
    expect(c.simulatedSeconds).toBe(0);
  });

  it('advances simulated time only in whole steps', () => {
    const c = new SimulationClock({ stepSeconds: 0.1 });
    c.advance(0.35);
    expect(c.simulatedSeconds).toBeCloseTo(0.3, 6);
    expect(c.stepCount).toBe(3);
  });
});

describe('DisposalRegistry', () => {
  it('releases in reverse registration order', () => {
    const order: string[] = [];
    const r = new DisposalRegistry('test');
    r.addTeardown(() => order.push('first'));
    r.addTeardown(() => order.push('second'));
    r.addTeardown(() => order.push('third'));
    r.dispose();
    expect(order).toEqual(['third', 'second', 'first']);
  });

  it('counts what it released, by kind', () => {
    const r = new DisposalRegistry('test');
    r.add({ dispose: () => {} }, 'geometry');
    r.add({ dispose: () => {} }, 'geometry');
    r.add({ dispose: () => {} }, 'texture');
    const report = r.dispose();
    expect(report.released).toBe(3);
    expect(report.byKind.geometry).toBe(2);
    expect(report.byKind.texture).toBe(1);
  });

  it('is idempotent — a second dispose is not a double free', () => {
    const free = vi.fn();
    const r = new DisposalRegistry('test');
    r.addTeardown(free);
    r.dispose();
    r.dispose();
    expect(free).toHaveBeenCalledTimes(1);
  });

  it('keeps going when one teardown throws, and reports it', () => {
    const good = vi.fn();
    const r = new DisposalRegistry('test');
    r.addTeardown(good, 'other', 'good');
    r.addTeardown(() => { throw new Error('bad'); }, 'other', 'explodes');
    const report = r.dispose();
    expect(good).toHaveBeenCalledTimes(1);
    expect(report.errors).toHaveLength(1);
    expect(report.errors[0].label).toBe('explodes');
  });

  it('disposes children before the parent', () => {
    const order: string[] = [];
    const parent = new DisposalRegistry('parent');
    parent.addTeardown(() => order.push('parent'));
    const child = parent.child('child');
    child.addTeardown(() => order.push('child'));
    parent.dispose();
    expect(order).toEqual(['child', 'parent']);
  });

  it('removes listeners it registered', () => {
    const target = new EventTarget();
    const handler = vi.fn();
    const r = new DisposalRegistry('test');
    r.addListener(target, 'ping', handler);
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
    r.dispose();
    target.dispatchEvent(new Event('ping'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('refuses to register into a disposed scope instead of leaking silently', () => {
    const r = new DisposalRegistry('test');
    r.dispose();
    expect(() => r.addTeardown(() => {})).toThrow(/already disposed/);
  });
});

describe('ZoneManager', () => {
  function builder(): ZoneBuilder & { built: string[]; chunks: string[] } {
    const built: string[] = [];
    const chunks: string[] = [];
    return {
      built,
      chunks,
      buildZone: (zone, scope) => {
        built.push(zone.id);
        scope.add({ dispose: () => {} }, 'geometry', `${zone.id}-terrain`);
      },
      buildChunk: (_zone, chunk, scope) => {
        chunks.push(chunk.id);
        scope.add({ dispose: () => {} }, 'geometry', chunk.id);
      },
    };
  }

  it('refuses to construct on an invalid manifest', () => {
    expect(
      () =>
        new ZoneManager(
          { version: 1, startZone: 'village_coast', zones: [] },
          builder(),
        ),
    ).toThrow(/invalid world manifest/);
  });

  it('enters the village and tracks its resources', async () => {
    const b = builder();
    const zm = new ZoneManager(WORLD_MANIFEST, b);
    await zm.enter('village_coast');
    expect(zm.activeZoneId).toBe('village_coast');
    expect(b.built).toEqual(['village_coast']);
    expect(zm.debugState().trackedResources).toBeGreaterThan(0);
  });

  it('will not enter a second zone while one is active', async () => {
    const zm = new ZoneManager(WORLD_MANIFEST, builder());
    await zm.enter('village_coast');
    await expect(zm.enter('city_old_market')).rejects.toThrow(/still active/);
  });

  it('gives everything back on leave', async () => {
    const zm = new ZoneManager(WORLD_MANIFEST, builder());
    await zm.enter('village_coast');
    await zm.leave();
    expect(zm.activeZoneId).toBeNull();
    expect(zm.debugState().trackedResources).toBe(0);
    expect(zm.debugState().residentCount).toBe(0);
  });

  it('streams chunks in a city zone and releases them on leave', async () => {
    const b = builder();
    const zm = new ZoneManager(WORLD_MANIFEST, b);
    await zm.enter('city_old_market');
    await zm.update(0, 0);
    expect(b.chunks.length).toBeGreaterThan(0);
    expect(zm.debugState().residentCount).toBeGreaterThan(0);
    await zm.leave();
    expect(zm.debugState().residentCount).toBe(0);
  });

  it('does not stream in an authored zone', async () => {
    const b = builder();
    const zm = new ZoneManager(WORLD_MANIFEST, b);
    await zm.enter('village_coast');
    await zm.update(0, 0);
    expect(b.chunks).toEqual([]);
  });

  it('returns to a clean state across 20 village-city round trips', async () => {
    const b = builder();
    const zm = new ZoneManager(WORLD_MANIFEST, b);
    for (let i = 0; i < 20; i++) {
      await zm.enter('village_coast');
      await zm.update(0, 0);
      await zm.leave();
      await zm.enter('city_old_market');
      await zm.update(0, 0);
      await zm.leave();
    }
    // The phase's memory target, expressed as object ownership: nothing is
    // still tracked and nothing is still resident.
    expect(zm.debugState().trackedResources).toBe(0);
    expect(zm.debugState().residentCount).toBe(0);
    expect(zm.activeZoneId).toBeNull();
  });

  it('does not leak when zone construction fails part-way', async () => {
    const disposed: string[] = [];
    const zm = new ZoneManager(WORLD_MANIFEST, {
      buildZone: (zone, scope) => {
        scope.addTeardown(() => disposed.push(zone.id));
        throw new Error('asset missing');
      },
      buildChunk: () => {},
    });
    await expect(zm.enter('village_coast')).rejects.toThrow(/asset missing/);
    expect(disposed).toEqual(['village_coast']);
    expect(zm.activeZoneId).toBeNull();
  });
});
