import { describe, it, expect } from 'vitest';
import {
  DEFAULT_LOD,
  POPULATION_BUDGETS,
  bandFor,
  rankForNear,
  type LodBand,
} from '../src/npc/NpcLod';

describe('band selection', () => {
  it('promotes on the plain threshold', () => {
    expect(bandFor(10, 'far')).toBe('near');
    expect(bandFor(DEFAULT_LOD.near, 'far')).toBe('near');
    expect(bandFor(DEFAULT_LOD.near + 0.1, 'far')).toBe('mid');
    expect(bandFor(DEFAULT_LOD.mid + 0.1, 'far')).toBe('far');
  });

  it('demotes only past the dead band', () => {
    const justOver = DEFAULT_LOD.near + DEFAULT_LOD.hysteresis - 0.1;
    expect(bandFor(justOver, 'near')).toBe('near');
    expect(bandFor(DEFAULT_LOD.near + DEFAULT_LOD.hysteresis + 0.1, 'near')).toBe('mid');

    expect(bandFor(DEFAULT_LOD.mid + DEFAULT_LOD.hysteresis - 0.1, 'mid')).toBe('mid');
    expect(bandFor(DEFAULT_LOD.mid + DEFAULT_LOD.hysteresis + 0.1, 'mid')).toBe('far');
  });

  it('does not thrash for an agent loitering on a boundary', () => {
    // The failure this prevents costs a WASM allocation per frame: adding and
    // removing a crowd agent is not free.
    let band: LodBand = 'far';
    const changes: LodBand[] = [];
    for (let i = 0; i < 40; i++) {
      // Oscillate by half a metre either side of the near threshold.
      const d = DEFAULT_LOD.near + (i % 2 === 0 ? -0.5 : 0.5);
      const next = bandFor(d, band);
      if (next !== band) changes.push(next);
      band = next;
    }
    expect(changes).toEqual(['near']);
  });

  it('can skip a band in one step when the player teleports', () => {
    expect(bandFor(500, 'near')).toBe('far');
    expect(bandFor(1, 'far')).toBe('near');
  });

  it('honours the tighter ranges of a lower preset', () => {
    const low = POPULATION_BUDGETS.low.lod;
    expect(bandFor(30, 'far', low)).toBe('mid');
    expect(bandFor(30, 'far')).toBe('near');
  });
});

describe('near-tier ranking', () => {
  const c = (id: string, distance: number, named = false) => ({ id, distance, named });

  it('takes the nearest when more want the tier than fit', () => {
    const picked = rankForNear([c('a', 30), c('b', 10), c('c', 20)], 2);
    expect([...picked].sort()).toEqual(['b', 'c']);
  });

  it('gives named residents a head start over pedestrians', () => {
    // The pedestrian is closer, but the resident is the one the player came to
    // talk to; losing them to a stranger walking past is the broken version.
    const picked = rankForNear([c('stranger', 9), c('resident', 12, true)], 1);
    expect([...picked]).toEqual(['resident']);
  });

  it('does not let the head start override a large gap', () => {
    const picked = rankForNear([c('stranger', 4), c('resident', 30, true)], 1);
    expect([...picked]).toEqual(['stranger']);
  });

  it('is stable when distances tie', () => {
    const first = rankForNear([c('b', 5), c('a', 5), c('c', 5)], 2);
    const second = rankForNear([c('c', 5), c('a', 5), c('b', 5)], 2);
    expect([...first].sort()).toEqual([...second].sort());
  });

  it('returns nothing when the budget is zero or negative', () => {
    expect(rankForNear([c('a', 1)], 0).size).toBe(0);
    expect(rankForNear([c('a', 1)], -5).size).toBe(0);
  });

  it('keeps everybody when the budget is generous', () => {
    expect(rankForNear([c('a', 1), c('b', 2)], 10).size).toBe(2);
  });
});

describe('population budgets', () => {
  it('scales monotonically with the preset', () => {
    const { low, medium, high } = POPULATION_BUDGETS;
    expect(low.maxNear).toBeLessThan(medium.maxNear);
    expect(medium.maxNear).toBeLessThan(high.maxNear);
    expect(low.maxAmbient).toBeLessThan(medium.maxAmbient);
    expect(medium.maxAmbient).toBeLessThan(high.maxAmbient);
    expect(low.maxTraffic).toBeLessThan(medium.maxTraffic);
    expect(medium.maxTraffic).toBeLessThan(high.maxTraffic);
  });

  it('bounds the far tick in every preset', () => {
    // "Far simulation cost is bounded and documented" is an acceptance
    // criterion; this is the bound.
    for (const b of Object.values(POPULATION_BUDGETS)) {
      expect(b.farPerTick).toBeGreaterThan(0);
      expect(b.farPerTick).toBeLessThanOrEqual(16);
    }
  });

  it('keeps near inside mid in every preset', () => {
    for (const b of Object.values(POPULATION_BUDGETS)) {
      expect(b.lod.near).toBeLessThan(b.lod.mid);
      expect(b.lod.hysteresis).toBeGreaterThan(0);
    }
  });
});
