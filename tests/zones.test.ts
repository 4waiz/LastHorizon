import { describe, it, expect, vi } from 'vitest';
import {
  buildChunkGrid,
  chunkSeed,
  validateWorldManifest,
  validateZone,
  type ZoneManifest,
  type WorldManifest,
} from '../src/world/zones/Manifest';
import { ChunkStreamer, computeDelta, distanceToChunk } from '../src/world/zones/ChunkStreamer';
import { SpawnRegistry } from '../src/world/zones/SpawnRegistry';
import { TravelService } from '../src/world/zones/TravelService';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';

const codes = (issues: { code: string }[]) => issues.map((i) => i.code);

/** A minimal streamed zone, so each test can bend one thing at a time. */
function streamedZone(over: Partial<ZoneManifest> = {}): ZoneManifest {
  const bounds = { minX: 0, minZ: 0, maxX: 96, maxZ: 96 };
  return {
    id: 'city_old_market',
    displayName: 'Test',
    kind: 'streamed',
    seed: 1234,
    chunkSize: 48,
    loadRadius: 2,
    unloadHysteresis: 14,
    bounds,
    spawns: [{ id: 's', x: 10, z: 10, facing: 0, vehicleSafe: true, clearance: 3 }],
    defaultSpawnId: 's',
    chunks: buildChunkGrid('city_old_market', 1234, 48, bounds),
    interiors: [],
    lanes: [],
    npcs: [],
    audio: { zoneTrack: 'city', ambience: [], reverb: 0 },
    weather: { windStrength: 1, fogFar: 400, defaultTimeMode: 'cycle' },
    bundles: [],
    neighbours: [],
    playable: true,
    ...over,
  };
}

describe('world manifest validation', () => {
  it('accepts the shipped world', () => {
    expect(validateWorldManifest(WORLD_MANIFEST)).toEqual([]);
  });

  it('declares the five zones the phase calls for', () => {
    const ids = WORLD_MANIFEST.zones.map((z) => z.id).sort();
    expect(ids).toEqual([
      'city_downtown',
      'city_old_market',
      'city_waterfront',
      'hill_airstrip',
      'village_coast',
    ]);
  });

  it('keeps the village authored, so nothing about it streams', () => {
    const v = WORLD_MANIFEST.zones.find((z) => z.id === 'village_coast')!;
    expect(v.kind).toBe('authored');
    expect(v.chunks).toHaveLength(0);
    expect(v.playable).toBe(true);
  });

  it('declares the airstrip but does not open it', () => {
    const a = WORLD_MANIFEST.zones.find((z) => z.id === 'hill_airstrip')!;
    expect(a.playable).toBe(false);
  });

  it('catches a default spawn that does not exist', () => {
    const issues = validateZone(streamedZone({ defaultSpawnId: 'nope' }));
    expect(codes(issues)).toContain('missing-default-spawn');
  });

  it('catches a spawn outside the zone bounds', () => {
    const z = streamedZone({
      spawns: [{ id: 's', x: 9999, z: 0, facing: 0, vehicleSafe: true, clearance: 3 }],
    });
    expect(codes(validateZone(z))).toContain('spawn-out-of-bounds');
  });

  it('refuses a playable zone with no vehicle-safe spawn', () => {
    const z = streamedZone({
      spawns: [{ id: 's', x: 10, z: 10, facing: 0, vehicleSafe: false, clearance: 3 }],
    });
    expect(codes(validateZone(z))).toContain('no-vehicle-spawn');
  });

  it('enforces the two-ring load budget', () => {
    expect(codes(validateZone(streamedZone({ loadRadius: 3 })))).toContain('load-radius-over-budget');
  });

  it('refuses a streamed zone with no hysteresis, which would thrash', () => {
    expect(codes(validateZone(streamedZone({ unloadHysteresis: 0 })))).toContain('no-hysteresis');
  });

  it('catches a lane pointing at a missing node', () => {
    const z = streamedZone({
      lanes: [{ id: 'a', x: 0, z: 0, next: ['ghost'], speedLimit: 10 }],
    });
    expect(codes(validateZone(z))).toContain('dangling-lane');
  });

  it('catches a one-way neighbour edge', () => {
    const world: WorldManifest = {
      version: 1,
      startZone: 'village_coast',
      zones: [
        streamedZone({ id: 'village_coast', neighbours: ['city_downtown'] }),
        streamedZone({ id: 'city_downtown', neighbours: [] }),
      ],
    };
    expect(codes(validateWorldManifest(world))).toContain('asymmetric-neighbour');
  });

  it('catches a start zone that is not declared', () => {
    const world: WorldManifest = {
      version: 1,
      startZone: 'hill_airstrip',
      zones: [streamedZone({ id: 'village_coast' })],
    };
    expect(codes(validateWorldManifest(world))).toContain('missing-start-zone');
  });
});

describe('deterministic placement', () => {
  it('gives the same chunk seed for the same coord, every time', () => {
    const a = chunkSeed(99, { cx: 3, cz: -7 });
    const b = chunkSeed(99, { cx: 3, cz: -7 });
    expect(a).toBe(b);
  });

  it('separates neighbouring coords and differing zone seeds', () => {
    expect(chunkSeed(99, { cx: 3, cz: -7 })).not.toBe(chunkSeed(99, { cx: 4, cz: -7 }));
    expect(chunkSeed(99, { cx: 3, cz: -7 })).not.toBe(chunkSeed(98, { cx: 3, cz: -7 }));
    // cx/cz must not be interchangeable, or the grid mirrors along a diagonal.
    expect(chunkSeed(99, { cx: 3, cz: -7 })).not.toBe(chunkSeed(99, { cx: -7, cz: 3 }));
  });

  it('builds an identical, ordered grid on repeat calls', () => {
    const bounds = { minX: 0, minZ: 0, maxX: 96, maxZ: 96 };
    const a = buildChunkGrid('city_downtown', 7, 48, bounds);
    const b = buildChunkGrid('city_downtown', 7, 48, bounds);
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a.map((c) => c.seed)).toEqual(b.map((c) => c.seed));
    expect(a).toHaveLength(4);
  });
});

describe('chunk streaming: radius and hysteresis', () => {
  const zone = streamedZone();

  it('loads only what is inside the radius', () => {
    const delta = computeDelta(zone, 0, 0, new Set());
    expect(delta.toUnload).toHaveLength(0);
    for (const c of delta.toLoad) {
      expect(distanceToChunk(c, 0, 0)).toBeLessThanOrEqual(zone.loadRadius * zone.chunkSize);
    }
  });

  it('orders loads nearest-first and deterministically', () => {
    const a = computeDelta(zone, 20, 20, new Set()).toLoad.map((c) => c.id);
    const b = computeDelta(zone, 20, 20, new Set()).toLoad.map((c) => c.id);
    expect(a).toEqual(b);
    expect(a[0]).toBe('city_old_market:0,0');
  });

  it('does NOT unload a chunk sitting inside the hysteresis dead band', () => {
    const far = zone.chunks[zone.chunks.length - 1];
    const resident = new Set([far.id]);
    // Just past the load radius but inside the dead band.
    const edge = zone.loadRadius * zone.chunkSize + zone.unloadHysteresis / 2;
    const x = far.bounds.minX - edge;
    const delta = computeDelta(zone, x, far.bounds.minZ, resident);
    expect(delta.toUnload.map((c) => c.id)).not.toContain(far.id);
  });

  it('unloads once past the dead band', () => {
    const far = zone.chunks[zone.chunks.length - 1];
    const resident = new Set([far.id]);
    const beyond = zone.loadRadius * zone.chunkSize + zone.unloadHysteresis + 1;
    const delta = computeDelta(zone, far.bounds.minX - beyond, far.bounds.minZ, resident);
    expect(delta.toUnload.map((c) => c.id)).toContain(far.id);
  });

  it('does not thrash when walking back and forth across a boundary', () => {
    const streamer = new ChunkStreamer({ load: () => {}, unload: () => {} });
    streamer.setZone(zone);
    const near = zone.loadRadius * zone.chunkSize;
    let churn = 0;
    // Oscillate across the threshold inside the dead band.
    return (async () => {
      await streamer.update(0, 0);
      const settled = streamer.residentCount;
      for (let i = 0; i < 12; i++) {
        const d = await streamer.update(0, near + (i % 2 === 0 ? 2 : -2));
        churn += d.toLoad.length + d.toUnload.length;
      }
      expect(settled).toBeGreaterThan(0);
      // Some churn is legitimate as new chunks come into range; the point is
      // that it converges rather than repeating every step.
      expect(churn).toBeLessThan(settled);
    })();
  });

  it('never exceeds the two-ring budget', async () => {
    const streamer = new ChunkStreamer({ load: () => {}, unload: () => {} });
    streamer.setZone(zone);
    await streamer.update(48, 48);
    expect(streamer.residentCount).toBeLessThanOrEqual(25); // 5x5
  });
});

describe('chunk lifecycle and disposal', () => {
  it('loads, becomes resident, then unloads exactly once each', async () => {
    const load = vi.fn();
    const unload = vi.fn();
    const streamer = new ChunkStreamer({ load, unload });
    const zone = streamedZone();
    streamer.setZone(zone);

    await streamer.update(0, 0);
    const loaded = load.mock.calls.length;
    expect(loaded).toBeGreaterThan(0);
    expect(streamer.residentCount).toBe(loaded);

    // Re-running at the same position must not reload anything.
    await streamer.update(0, 0);
    expect(load).toHaveBeenCalledTimes(loaded);

    await streamer.unloadAll();
    expect(unload).toHaveBeenCalledTimes(loaded);
    expect(streamer.residentCount).toBe(0);
  });

  it('returns to zero residency after a round trip, leaving nothing behind', async () => {
    const live = new Set<string>();
    const streamer = new ChunkStreamer({
      load: (c) => { live.add(c.id); },
      unload: (c) => { live.delete(c.id); },
    });
    streamer.setZone(streamedZone());

    for (let i = 0; i < 20; i++) {
      await streamer.update(0, 0);
      await streamer.update(1000, 1000); // far outside every chunk
    }
    expect(live.size).toBe(0);
    expect(streamer.residentCount).toBe(0);
  });

  it('does not leave a slot claimed when a load fails', async () => {
    const streamer = new ChunkStreamer({
      load: () => Promise.reject(new Error('bundle missing')),
      unload: () => {},
    });
    streamer.setZone(streamedZone());
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await streamer.update(0, 0);
    expect(streamer.residentCount).toBe(0);
    warn.mockRestore();
  });
});

describe('spawn safety', () => {
  const reg = new SpawnRegistry(WORLD_MANIFEST);

  it('resolves the requested spawn when it is valid', () => {
    const r = reg.resolve({ zoneId: 'village_coast', spawnId: 'village_start' });
    expect(r.ok && r.spawn.id).toBe('village_start');
    expect(r.ok && r.fallback).toBe(false);
  });

  it('falls back to the zone default when the saved spawn is gone', () => {
    const r = reg.resolve({ zoneId: 'village_coast', spawnId: 'deleted_in_a_later_patch' });
    expect(r.ok).toBe(true);
    expect(r.ok && r.fallback).toBe(true);
    expect(r.ok && r.spawn.id).toBe('village_start');
  });

  it('never puts a vehicle on a foot-only spawn', () => {
    const r = reg.resolve({ zoneId: 'village_coast', spawnId: 'village_hill', withVehicle: true });
    expect(r.ok).toBe(true);
    expect(r.ok && r.spawn.vehicleSafe).toBe(true);
    expect(r.ok && r.spawn.id).not.toBe('village_hill');
  });

  it('honours a clearance requirement', () => {
    const r = reg.resolve({ zoneId: 'village_coast', requiredClearance: 3.5 });
    expect(r.ok && r.spawn.clearance).toBeGreaterThanOrEqual(3.5);
  });

  it('refuses a zone that is not open yet rather than guessing', () => {
    const r = reg.resolve({ zoneId: 'hill_airstrip' });
    expect(r.ok).toBe(false);
  });

  it('reports rather than throwing when nothing can satisfy the request', () => {
    const r = reg.resolve({ zoneId: 'village_coast', requiredClearance: 999 });
    expect(r.ok).toBe(false);
  });
});

describe('travel', () => {
  const reg = new SpawnRegistry(WORLD_MANIFEST);

  function service(over: Partial<{ prepare: () => Promise<void>; release: () => Promise<void> }> = {}) {
    const calls: string[] = [];
    const svc = new TravelService(reg, {
      prepare: over.prepare ?? (async () => { calls.push('prepare'); }),
      release: over.release ?? (async () => { calls.push('release'); }),
      fade: async (d) => { calls.push(`fade:${d}`); },
    });
    return { svc, calls };
  }

  it('travels village -> city and reports a return context', async () => {
    const { svc, calls } = service();
    const r = await svc.travel({
      to: 'city_old_market',
      context: { fromZone: 'village_coast', fromSpawnId: 'village_road_north' },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.zoneId).toBe('city_old_market');
    expect(r.ok && r.returnContext.fromZone).toBe('city_old_market');
    // Fade out before prepare; release only after prepare succeeded.
    expect(calls.indexOf('fade:out')).toBeLessThan(calls.indexOf('prepare'));
    expect(calls.indexOf('prepare')).toBeLessThan(calls.indexOf('release'));
  });

  it('returns the player to the door they left from', async () => {
    const { svc } = service();
    await svc.travel({
      to: 'city_old_market',
      context: { fromZone: 'village_coast', fromSpawnId: 'village_road_north' },
    });
    const back = await svc.returnHome('city_old_market');
    expect(back.ok).toBe(true);
    expect(back.ok && back.zoneId).toBe('village_coast');
    expect(back.ok && back.spawn.id).toBe('village_road_north');
  });

  it('leaves the player where they were when the destination fails to load', async () => {
    const released: string[] = [];
    const svc = new TravelService(reg, {
      prepare: async () => { throw new Error('bundle 404'); },
      release: async (z) => { released.push(z); },
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const r = await svc.travel({
      to: 'city_old_market',
      context: { fromZone: 'village_coast' },
    });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.stayedIn).toBe('village_coast');
    expect(!r.ok && r.message).toMatch(/still in/i);
    // Critically: the source zone was never torn down.
    expect(released).toEqual([]);
    warn.mockRestore();
  });

  it('refuses a zone that is not a neighbour', async () => {
    const { svc } = service();
    const r = await svc.travel({ to: 'city_downtown', context: { fromZone: 'village_coast' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.stayedIn).toBe('village_coast');
  });

  it('refuses a zone that is not open yet', async () => {
    const { svc } = service();
    const r = await svc.travel({ to: 'hill_airstrip', context: { fromZone: 'village_coast' } });
    expect(r.ok).toBe(false);
    expect(!r.ok && r.message).toMatch(/not open/i);
  });

  it('keeps the return entry when the return trip itself fails', async () => {
    let allow = true;
    const svc = new TravelService(reg, {
      prepare: async () => { if (!allow) throw new Error('nope'); },
      release: async () => {},
    });
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    await svc.travel({
      to: 'city_old_market',
      context: { fromZone: 'village_coast', fromSpawnId: 'village_road_north' },
    });
    allow = false;
    const failed = await svc.returnHome('city_old_market');
    expect(failed.ok).toBe(false);
    // The history entry must survive so the player is not stranded.
    allow = true;
    const retried = await svc.returnHome('city_old_market');
    expect(retried.ok).toBe(true);
    warn.mockRestore();
  });

  it('arriving by vehicle lands on a vehicle-safe spawn', async () => {
    const { svc } = service();
    const r = await svc.travel({
      to: 'city_old_market',
      toSpawnId: 'market_square', // foot-only
      context: { fromZone: 'village_coast', withVehicle: true, vehicleId: 'bike_1' },
    });
    expect(r.ok).toBe(true);
    expect(r.ok && r.spawn.vehicleSafe).toBe(true);
    expect(r.ok && r.usedFallbackSpawn).toBe(true);
  });
});
