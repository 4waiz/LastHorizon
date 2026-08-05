import { describe, it, expect } from 'vitest';
import {
  ADULT_AGE,
  VILLAGE_DEPARTURE_CHAPTER,
  can,
  canEnterZone,
  lockedCapabilities,
  type GateContext,
} from '../src/core/Gates';
import type { ZoneId } from '../src/world/zones/Manifest';

function ctx(over: Partial<GateContext> = {}): GateContext {
  return {
    mode: 'story',
    age: 15,
    completedChapters: new Set<string>(),
    unlockedZones: new Set<ZoneId>(['village_coast']),
    ...over,
  };
}

describe('adult gates apply in both modes', () => {
  const adult = ['weapons', 'weapon_shops', 'violent_crime'] as const;

  for (const cap of adult) {
    it(`${cap} is locked below ${ADULT_AGE}`, () => {
      for (const mode of ['story', 'freeRoam'] as const) {
        for (let age = 15; age < ADULT_AGE; age++) {
          const v = can(cap, ctx({ mode, age }));
          expect(v.allowed, `${mode} @${age}`).toBe(false);
          expect(v.reason).toBeTruthy();
        }
      }
    });

    it(`${cap} opens exactly at ${ADULT_AGE}`, () => {
      expect(can(cap, ctx({ age: ADULT_AGE - 1 })).allowed).toBe(false);
      expect(can(cap, ctx({ age: ADULT_AGE })).allowed).toBe(true);
    });
  }

  it('Free Roam cannot skip the adult gate by unlocking zones', () => {
    const v = can('weapons', ctx({
      mode: 'freeRoam',
      age: 16,
      unlockedZones: new Set<ZoneId>(['village_coast', 'city_old_market']),
    }));
    expect(v.allowed).toBe(false);
  });
});

describe('city access', () => {
  it('needs both age and the village departure chapter in Story Mode', () => {
    // Old enough, chapter unfinished.
    expect(can('city_access', ctx({ age: 18 })).allowed).toBe(false);
    // Chapter finished, too young.
    expect(
      can('city_access', ctx({ age: 17, completedChapters: new Set([VILLAGE_DEPARTURE_CHAPTER]) }))
        .allowed,
    ).toBe(false);
    // Both.
    expect(
      can('city_access', ctx({ age: 18, completedChapters: new Set([VILLAGE_DEPARTURE_CHAPTER]) }))
        .allowed,
    ).toBe(true);
  });

  it('explains which requirement is missing', () => {
    expect(can('city_access', ctx({ age: 15 })).reason).toMatch(/15/);
    expect(can('city_access', ctx({ age: 18 })).reason).toMatch(/village/i);
  });

  it('honours the chosen unlocks in Free Roam, with no chapter requirement', () => {
    const open = ctx({
      mode: 'freeRoam',
      age: 15,
      unlockedZones: new Set<ZoneId>(['village_coast', 'city_old_market']),
    });
    expect(can('city_access', open).allowed).toBe(true);

    const closed = ctx({ mode: 'freeRoam', age: 40 });
    expect(can('city_access', closed).allowed).toBe(false);
  });
});

describe('zone gates', () => {
  const storyOpen = ctx({
    age: 18,
    completedChapters: new Set([VILLAGE_DEPARTURE_CHAPTER]),
  });

  it('always allows the village', () => {
    expect(canEnterZone('village_coast', ctx()).allowed).toBe(true);
  });

  it('refuses city districts before the city opens', () => {
    for (const z of ['city_old_market', 'city_downtown', 'city_waterfront'] as ZoneId[]) {
      expect(canEnterZone(z, ctx()).allowed, z).toBe(false);
    }
  });

  it('opens the first district once the city gate passes', () => {
    expect(canEnterZone('city_old_market', storyOpen).allowed).toBe(true);
  });

  it('still gates the further districts individually', () => {
    expect(canEnterZone('city_downtown', storyOpen).allowed).toBe(false);
    const withDowntown = ctx({
      age: 18,
      completedChapters: new Set([VILLAGE_DEPARTURE_CHAPTER]),
      unlockedZones: new Set<ZoneId>(['village_coast', 'city_downtown']),
    });
    expect(canEnterZone('city_downtown', withDowntown).allowed).toBe(true);
  });

  it('keeps the airstrip shut until it is unlocked', () => {
    expect(canEnterZone('hill_airstrip', storyOpen).allowed).toBe(false);
    const withStrip = ctx({
      age: 18,
      completedChapters: new Set([VILLAGE_DEPARTURE_CHAPTER]),
      unlockedZones: new Set<ZoneId>(['village_coast', 'hill_airstrip']),
    });
    expect(canEnterZone('hill_airstrip', withStrip).allowed).toBe(true);
  });
});

describe('driving', () => {
  it('lets a 15-year-old ride a bicycle', () => {
    expect(can('drive_bicycle', ctx({ age: 15 })).allowed).toBe(true);
  });

  it('holds motor vehicles until 17', () => {
    expect(can('drive_motor_vehicle', ctx({ age: 16 })).allowed).toBe(false);
    expect(can('drive_motor_vehicle', ctx({ age: 17 })).allowed).toBe(true);
  });
});

describe('locked list, for the UI', () => {
  it('lists what is locked with a reason for each', () => {
    const locked = lockedCapabilities(ctx({ age: 15 }));
    const names = locked.map((l) => l.capability);
    expect(names).toContain('weapons');
    expect(names).toContain('city_access');
    expect(names).not.toContain('drive_bicycle');
    for (const l of locked) expect(l.reason.length).toBeGreaterThan(0);
  });

  it('is empty for a fully unlocked adult run', () => {
    const open = ctx({
      mode: 'freeRoam',
      age: 30,
      unlockedZones: new Set<ZoneId>(['village_coast', 'city_old_market']),
    });
    expect(lockedCapabilities(open)).toEqual([]);
  });
});
