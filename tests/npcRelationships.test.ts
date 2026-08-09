import { describe, it, expect } from 'vitest';
import {
  GREETING_FAMILIARITY,
  RELATIONSHIP_AXES,
  RelationshipStore,
  NEUTRAL,
} from '../src/npc/Relationships';
import { NPC_CATALOGUE } from '../src/npc/npcCatalog';

describe('relationship axes', () => {
  it('has exactly the five the brief asks for', () => {
    expect([...RELATIONSHIP_AXES]).toEqual([
      'familiarity',
      'trust',
      'affection',
      'fear',
      'respect',
    ]);
  });

  it('starts everybody neutral', () => {
    const store = new RelationshipStore();
    expect(store.get('nobody')).toEqual({ ...NEUTRAL });
    expect(store.has('nobody')).toBe(false);
  });

  it('hands out copies, not the live record', () => {
    const store = new RelationshipStore();
    store.set('a', { trust: 0.4 });
    const taken = store.get('a');
    taken.trust = 1;
    expect(store.get('a').trust).toBe(0.4);
  });
});

describe('clamping', () => {
  it('holds every axis inside 0..1 however many deltas arrive', () => {
    const store = new RelationshipStore();
    for (let i = 0; i < 200; i++) store.adjust('a', { trust: 0.1, fear: -0.1 });
    expect(store.get('a').trust).toBe(1);
    expect(store.get('a').fear).toBe(0);
  });

  it('ignores a non-finite delta rather than poisoning the axis', () => {
    const store = new RelationshipStore();
    store.set('a', { trust: 0.5 });
    store.adjust('a', { trust: NaN });
    expect(store.get('a').trust).toBe(0.5);
    store.adjust('a', { trust: Infinity });
    expect(store.get('a').trust).toBe(0.5);
  });

  it('clamps on set as well as on adjust', () => {
    const store = new RelationshipStore();
    store.set('a', { affection: 40, fear: -3 });
    expect(store.get('a').affection).toBe(1);
    expect(store.get('a').fear).toBe(0);
  });
});

describe('greeting', () => {
  it('moves familiarity and nothing else', () => {
    const store = new RelationshipStore();
    const after = store.greet('a');
    expect(after.familiarity).toBeCloseTo(GREETING_FAMILIARITY, 6);
    expect(after.trust).toBe(0);
    expect(after.affection).toBe(0);
    expect(after.respect).toBe(0);
  });

  it('has diminishing returns, so nobody is befriended by repetition', () => {
    const store = new RelationshipStore();
    const first = store.greet('a').familiarity;
    for (let i = 0; i < 500; i++) store.greet('a');
    const eventual = store.get('a').familiarity;
    expect(eventual).toBeLessThan(1);
    expect(eventual).toBeGreaterThan(first);

    const before = eventual;
    store.greet('a');
    expect(store.get('a').familiarity - before).toBeLessThan(first);
  });
});

describe('persistence', () => {
  it('round-trips through save and load unchanged', () => {
    const store = new RelationshipStore();
    store.set('v_maryam', { familiarity: 0.55, trust: 0.4, affection: 0.3, respect: 0.35 });
    store.set('v_noor', { familiarity: 0.7, fear: 0.1 });

    const json = store.toJSON();
    const restored = new RelationshipStore();
    restored.fromJSON(json);

    expect(restored.get('v_maryam')).toEqual(store.get('v_maryam'));
    expect(restored.get('v_noor')).toEqual(store.get('v_noor'));
    expect(restored.size).toBe(2);
  });

  it('serialises in a stable order, so two saves of one state match', () => {
    const a = new RelationshipStore();
    a.set('zeta', { trust: 0.2 });
    a.set('alpha', { trust: 0.3 });
    const b = new RelationshipStore();
    b.set('alpha', { trust: 0.3 });
    b.set('zeta', { trust: 0.2 });
    expect(JSON.stringify(a.toJSON())).toBe(JSON.stringify(b.toJSON()));
  });

  it('survives a save that names a resident who no longer exists', () => {
    // Content changes between versions; a removed resident must not cost the
    // player their save.
    const store = new RelationshipStore();
    store.fromJSON([
      { npcId: 'v_maryam', familiarity: 0.5, trust: 0.5, affection: 0, fear: 0, respect: 0 },
      { npcId: 'deleted_in_a_later_phase', familiarity: 1, trust: 1, affection: 1, fear: 1, respect: 1 },
    ]);
    expect(store.get('v_maryam').trust).toBe(0.5);
    expect(store.size).toBe(2);
  });

  it('tolerates a missing or malformed array', () => {
    const store = new RelationshipStore();
    store.set('a', { trust: 1 });
    store.fromJSON(undefined);
    expect(store.size).toBe(0);
    store.fromJSON([{ npcId: '' } as never, null as never]);
    expect(store.size).toBe(0);
  });

  it('replaces rather than merges, so loading a save is not additive', () => {
    const store = new RelationshipStore();
    store.set('a', { trust: 1 });
    store.fromJSON([{ npcId: 'b', familiarity: 0, trust: 0.2, affection: 0, fear: 0, respect: 0 }]);
    expect(store.has('a')).toBe(false);
    expect(store.get('b').trust).toBe(0.2);
  });
});

describe('seeding from the catalogue', () => {
  it('applies the starting values the catalogue declares', () => {
    const store = new RelationshipStore();
    for (const npc of NPC_CATALOGUE) store.set(npc.id, npc.initialRelationship ?? {});
    // Maryam is the shopkeeper the prologue already knows.
    expect(store.get('v_maryam').familiarity).toBeCloseTo(0.55, 6);
    // Sana is a stranger in the city.
    expect(store.get('c_sana').trust).toBe(0);
  });

  it('describes a relationship in words rather than a number', () => {
    expect(RelationshipStore.describe({ ...NEUTRAL })).toBe('a stranger');
    expect(RelationshipStore.describe({ ...NEUTRAL, familiarity: 0.6 })).toBe('a familiar face');
    expect(RelationshipStore.describe({ ...NEUTRAL, trust: 0.8, affection: 0.8 })).toBe(
      'a close friend',
    );
    expect(RelationshipStore.describe({ ...NEUTRAL, fear: 0.9, affection: 1 })).toBe('wary of you');
  });
});
