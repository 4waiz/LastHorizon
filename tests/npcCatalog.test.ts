import { describe, it, expect } from 'vitest';
import { NPC_CATALOGUE, npcById } from '../src/npc/npcCatalog';
import { npcsInZone, validateNpcCatalogue, type NamedNpcDefinition } from '../src/npc/NpcDefinition';
import { WORLD_MANIFEST } from '../src/world/zones/worldManifest';
import { scheduleById } from '../src/npc/schedules';
import { BARK_SETS } from '../src/npc/Dialogue';

const boundsFor = (zone: string) =>
  WORLD_MANIFEST.zones.find((z) => z.id === zone)?.bounds ?? null;

describe('the shipped catalogue', () => {
  it('passes its own validation', () => {
    expect(validateNpcCatalogue(NPC_CATALOGUE, boundsFor)).toEqual([]);
  });

  it('hits the MVP population target', () => {
    expect(npcsInZone(NPC_CATALOGUE, 'village_coast')).toHaveLength(8);
    const city =
      npcsInZone(NPC_CATALOGUE, 'city_old_market').length +
      npcsInZone(NPC_CATALOGUE, 'city_downtown').length +
      npcsInZone(NPC_CATALOGUE, 'city_waterfront').length;
    expect(city).toBe(12);
    expect(NPC_CATALOGUE).toHaveLength(20);
  });

  it('gives every resident a schedule that exists', () => {
    for (const npc of NPC_CATALOGUE) {
      expect(scheduleById(npc.scheduleId), `${npc.id} -> ${npc.scheduleId}`).not.toBeNull();
    }
  });

  it('gives every resident a bark set that exists', () => {
    const ids = new Set(BARK_SETS.map((b) => b.id));
    for (const npc of NPC_CATALOGUE) {
      expect(ids.has(npc.barkSet), `${npc.id} -> ${npc.barkSet}`).toBe(true);
    }
  });

  it('keeps every anchor inside its own zone', () => {
    for (const npc of NPC_CATALOGUE) {
      const bounds = boundsFor(npc.zone)!;
      for (const slot of ['home', 'work', 'leisure', 'social'] as const) {
        const a = npc.anchors[slot];
        expect(a.x, `${npc.id}.${slot}.x`).toBeGreaterThanOrEqual(bounds.minX);
        expect(a.x, `${npc.id}.${slot}.x`).toBeLessThanOrEqual(bounds.maxX);
        expect(a.z, `${npc.id}.${slot}.z`).toBeGreaterThanOrEqual(bounds.minZ);
        expect(a.z, `${npc.id}.${slot}.z`).toBeLessThanOrEqual(bounds.maxZ);
      }
    }
  });

  it('never puts a resident in the player family home', () => {
    // HouseLarge at (-15.8, 62) is the door `village_home` opens; a resident
    // living there would be standing in the player's kitchen.
    for (const npc of npcsInZone(NPC_CATALOGUE, 'village_coast')) {
      const d = Math.hypot(npc.anchors.home.x + 11.8, npc.anchors.home.z - 60.65);
      expect(d, `${npc.id} lives on the player's doorstep`).toBeGreaterThan(3);
    }
  });

  it('resolves by id and returns null for anything else', () => {
    expect(npcById('v_maryam')?.displayName).toBe('Maryam Haddad');
    expect(npcById('nobody')).toBeNull();
  });
});

describe('zone absence', () => {
  it('gives a zone nobody lives in an empty list rather than a surprise', () => {
    // `hill_airstrip` is declared and not yet playable. A population built for
    // it must be empty, not undefined and not everybody.
    expect(npcsInZone(NPC_CATALOGUE, 'hill_airstrip')).toEqual([]);
  });

  it('never returns a resident of one zone when asked about another', () => {
    for (const zone of ['village_coast', 'city_old_market', 'city_downtown', 'city_waterfront'] as const) {
      for (const npc of npcsInZone(NPC_CATALOGUE, zone)) {
        expect(npc.zone).toBe(zone);
      }
    }
  });

  it('accounts for every resident exactly once across the zones', () => {
    const counted = (['village_coast', 'city_old_market', 'city_downtown', 'city_waterfront', 'hill_airstrip'] as const)
      .flatMap((z) => npcsInZone(NPC_CATALOGUE, z));
    expect(counted).toHaveLength(NPC_CATALOGUE.length);
    expect(new Set(counted.map((n) => n.id)).size).toBe(NPC_CATALOGUE.length);
  });
});

describe('the child rule', () => {
  it('has no combat-capable NPC at all in this phase', () => {
    for (const npc of NPC_CATALOGUE) {
      expect(npc.combatCapable, `${npc.id}`).toBe(false);
    }
  });

  it('is enforced by validation, not only by the data happening to comply', () => {
    const child: NamedNpcDefinition = {
      ...NPC_CATALOGUE[0],
      id: 'test_child',
      ageBand: 'child',
      startAge: 9,
      combatCapable: true,
    };
    const codes = validateNpcCatalogue([child], boundsFor).map((i) => i.code);
    expect(codes).toContain('child-combatant');
  });
});

describe('catalogue validation catches the rest', () => {
  it('flags a duplicate id', () => {
    const codes = validateNpcCatalogue(
      [NPC_CATALOGUE[0], NPC_CATALOGUE[0]],
      boundsFor,
    ).map((i) => i.code);
    expect(codes).toContain('duplicate-id');
  });

  it('flags an anchor outside the zone', () => {
    const strayed: NamedNpcDefinition = {
      ...NPC_CATALOGUE[0],
      id: 'strayed',
      anchors: {
        ...NPC_CATALOGUE[0].anchors,
        work: { id: 'far_away', x: 9000, z: 9000 },
      },
    };
    const codes = validateNpcCatalogue([strayed], boundsFor).map((i) => i.code);
    expect(codes).toContain('anchor-out-of-bounds');
  });

  it('flags a missing schedule and an unknown zone', () => {
    const broken: NamedNpcDefinition = {
      ...NPC_CATALOGUE[0],
      id: 'broken',
      scheduleId: 'no_such_schedule',
    };
    expect(validateNpcCatalogue([broken], boundsFor).map((i) => i.code)).toContain(
      'missing-schedule',
    );
    expect(validateNpcCatalogue([broken], () => null).map((i) => i.code)).toContain('unknown-zone');
  });

  it('flags an age band that does not match the age', () => {
    const youngElder: NamedNpcDefinition = {
      ...NPC_CATALOGUE[0],
      id: 'young_elder',
      ageBand: 'elder',
      startAge: 32,
    };
    expect(validateNpcCatalogue([youngElder], boundsFor).map((i) => i.code)).toContain(
      'elder-age-mismatch',
    );
  });
});
