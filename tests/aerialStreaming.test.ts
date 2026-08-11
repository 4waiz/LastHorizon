import { describe, it, expect } from 'vitest';
import {
  AERIAL_POLICY,
  ChunkStreamer,
  computeDelta,
  ringsAt,
  type AerialPolicy,
} from '../src/world/zones/ChunkStreamer';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';
import { buildChunkGrid } from '../src/world/zones/Manifest';
import type { ChunkManifest, ZoneManifest } from '../src/world/zones/Manifest';

/**
 * *"Aircraft should not force all world chunks to load."*
 *
 * That sentence from the Phase 10 brief is the whole of this file. The
 * aeroplane cruises at 34 m/s and a chunk is 48 m, so a district crossed at
 * altitude on the pedestrian load radius means building and disposing the
 * entire zone in a few seconds — for scenery being looked at from 300 m.
 *
 * `ringsAt` is where that is prevented, and it is pure, so the proof is
 * arithmetic rather than a frame counter.
 */

const district = WORLD_MANIFEST.zones.find((z) => z.id === 'city_downtown')!;
const village = WORLD_MANIFEST.zones.find((z) => z.id === 'village_coast')!;

describe('the load radius fades with height', () => {
  it('leaves a pedestrian exactly as they were', () => {
    expect(ringsAt(district, 0)).toBe(district.loadRadius);
    expect(ringsAt(district, AERIAL_POLICY.groundCeiling)).toBe(district.loadRadius);
  });

  it('holds one ring under an aeroplane at cruise height', () => {
    expect(ringsAt(district, AERIAL_POLICY.aerialFloor)).toBe(AERIAL_POLICY.minRings);
    expect(ringsAt(district, 600)).toBe(AERIAL_POLICY.minRings);
  });

  it('never drops to nothing, however high', () => {
    // Zero rings would mean an aeroplane descending has no ground under it
    // for however long a chunk takes to build, and the first thing it meets
    // is that ground.
    expect(ringsAt(district, 10_000)).toBeGreaterThan(0);
    expect(AERIAL_POLICY.minRings).toBeGreaterThan(0);
  });

  it('fades rather than steps, so level flight at the threshold is smooth', () => {
    const mid = (AERIAL_POLICY.groundCeiling + AERIAL_POLICY.aerialFloor) / 2;
    const r = ringsAt(district, mid);
    expect(r).toBeLessThan(district.loadRadius);
    expect(r).toBeGreaterThan(AERIAL_POLICY.minRings);
    // Monotonic all the way up, or a climb would load chunks it just dropped.
    let last = Infinity;
    for (let agl = 0; agl <= 400; agl += 7) {
      const cur = ringsAt(district, agl);
      expect(cur).toBeLessThanOrEqual(last + 1e-9);
      last = cur;
    }
  });

  it('treats a negative altitude as ground level rather than as extra rings', () => {
    expect(ringsAt(district, -50)).toBe(district.loadRadius);
  });

  it('never asks a zone for more rings than it declares', () => {
    const shallow: ZoneManifest = { ...district, loadRadius: 1 };
    for (const agl of [0, 50, 120, 300]) {
      expect(ringsAt(shallow, agl)).toBeLessThanOrEqual(1);
    }
  });
});

describe('what a crossing actually costs', () => {
  /**
   * Fly straight across the district, reporting peak residency and the total
   * number of chunks ever touched.
   *
   * **Peak is the number that matters, and `touched` deliberately is not.**
   * The first version of this test asserted that a high crossing touches fewer
   * chunks than a low one and failed at 12 against 12 — correctly. Every
   * district is 4x3 chunks over 192x144 m, so a single ring already reaches
   * every row from the centre line; sweeping across one visits all twelve at
   * any radius at all. What altitude changes is how many are resident *at
   * once*, which is what memory, draw calls and disposal churn are actually
   * spent on.
   */
  function crossing(altitude: number): { peak: number; touched: number } {
    const seen = new Set<string>();
    const resident = new Set<string>();
    const b = district.bounds;
    let peak = 0;

    for (let x = b.minX; x <= b.maxX; x += 8) {
      const delta = computeDelta(district, x, (b.minZ + b.maxZ) / 2, resident, altitude);
      for (const c of delta.toLoad) {
        seen.add(c.id);
        resident.add(c.id);
      }
      for (const c of delta.toUnload) resident.delete(c.id);
      peak = Math.max(peak, resident.size);
    }
    return { peak, touched: seen.size };
  }

  /**
   * **The shipped districts are too small for this policy to save anything,
   * and that is worth a test rather than a silence.**
   *
   * One ring is 48 m and the hysteresis is 14, so a chunk is kept until it is
   * 62 m from the viewer. From the middle of a 192 x 144 m district the
   * furthest chunk's near edge is hypot(48, 24) = 53.7 m away — inside that.
   * So every chunk stays resident at any altitude, and peak residency is
   * twelve either way.
   *
   * Two earlier versions of this file asserted a saving here and failed at 12
   * against 12, twice. The policy is a guard against a district large enough
   * to matter, not a present-day optimisation, and the honest thing is to say
   * so and check the arithmetic that makes it true — so that if a zone ever
   * outgrows the keep distance, this test is what notices.
   */
  it('changes nothing for a district smaller than the keep distance', () => {
    const keep = AERIAL_POLICY.minRings * district.chunkSize + district.unloadHysteresis;
    const halfSpanX = (district.bounds.maxX - district.bounds.minX) / 2;
    const halfSpanZ = (district.bounds.maxZ - district.bounds.minZ) / 2;
    // Distance from the centre to the nearest edge of the furthest chunk.
    const furthest = Math.hypot(halfSpanX - district.chunkSize, halfSpanZ - district.chunkSize);
    expect(furthest).toBeLessThan(keep);

    expect(crossing(0).peak).toBe(district.chunks.length);
    expect(crossing(300).peak).toBe(district.chunks.length);
  });

  it('does bite on a district large enough to need it', () => {
    // Same shape, four times the extent. This is what the policy is for.
    const big: ZoneManifest = {
      ...district,
      bounds: { minX: -384, minZ: -384, maxX: 384, maxZ: 384 },
      chunks: buildChunkGrid('city_downtown', district.seed, district.chunkSize, {
        minX: -384,
        minZ: -384,
        maxX: 384,
        maxZ: 384,
      }),
    };

    const resident = new Set<string>();
    const at = (altitude: number): number => {
      resident.clear();
      const d = computeDelta(big, 0, 0, resident, altitude);
      return d.toLoad.length;
    };

    expect(at(300)).toBeLessThan(at(0));
    expect(at(300)).toBeGreaterThan(0);
    expect(at(300)).toBeLessThan(big.chunks.length);
  });

  it('still builds ground under the flight path', () => {
    // The point of `minRings` being 1 rather than 0. Something is always there.
    expect(crossing(300).peak).toBeGreaterThan(0);
  });
});

describe('the streamer honours the policy', () => {
  function streamer(): { s: ChunkStreamer; loaded: string[]; unloaded: string[] } {
    const loaded: string[] = [];
    const unloaded: string[] = [];
    const s = new ChunkStreamer({
      load: (c: ChunkManifest) => void loaded.push(c.id),
      unload: (c: ChunkManifest) => void unloaded.push(c.id),
    });
    s.setZone(district);
    return { s, loaded, unloaded };
  }

  it('defaults to ground level, so every existing caller is unchanged', async () => {
    const a = streamer();
    const b = streamer();
    await a.s.update(0, 160);
    await b.s.update(0, 160, 0);
    expect(a.s.debugResident()).toEqual(b.s.debugResident());
  });

  it('keeps a smaller resident set when the viewer climbs', async () => {
    const ground = streamer();
    await ground.s.update(0, 160, 0);

    const air = streamer();
    await air.s.update(0, 160, 400);

    expect(air.s.residentCount).toBeLessThan(ground.s.residentCount);
    expect(air.s.residentCount).toBeGreaterThan(0);
  });

  /*
   * No climb-and-release case here, deliberately.
   *
   * It would need a district bigger than the keep distance to have anything
   * to release, and `computeDelta` is where that is already proven above. A
   * streamer test that constructs a synthetic zone to make a point about
   * arithmetic is testing `computeDelta` through two extra layers.
   */

  it('does nothing at all for an authored zone, at any height', async () => {
    const { s, loaded } = streamer();
    s.setZone(village);
    await s.update(0, 0, 300);
    expect(loaded).toEqual([]);
  });
});

describe('the policy is data, not a hard-coded number', () => {
  it('respects a caller-supplied policy', () => {
    const strict: AerialPolicy = { groundCeiling: 5, aerialFloor: 10, minRings: 1 };
    expect(ringsAt(district, 4, strict)).toBe(district.loadRadius);
    expect(ringsAt(district, 12, strict)).toBe(1);
  });

  it('brings the proxy up before the radius starts falling', async () => {
    // `PROXY_ALTITUDE` lives in `CityRuntime` and is deliberately below
    // `groundCeiling`: the stand-in has to be visible before chunks begin
    // leaving, or there is a window with neither.
    const { PROXY_ALTITUDE } = await import('../src/world/zones/CityRuntime');
    expect(PROXY_ALTITUDE).toBeLessThan(AERIAL_POLICY.groundCeiling);
  });
});
