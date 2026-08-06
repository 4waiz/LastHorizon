import { describe, it, expect } from 'vitest';
import {
  Equipment,
  Inventory,
  ITEMS,
  itemDef,
  DEFAULT_SLOT_LIMIT,
} from '../src/player/Inventory';
import {
  DRAIN_MINUTES,
  LOW_MARK,
  NEED_IDS,
  Needs,
  type NeedId,
} from '../src/player/Needs';

const MINUTE = 60;
const HOUR = 60 * MINUTE;

describe('inventory basics', () => {
  it('adds and counts', () => {
    const inv = new Inventory();
    expect(inv.add('apple', 3)).toEqual({ added: 3, overflow: 0 });
    expect(inv.count('apple')).toBe(3);
    expect(inv.has('apple', 3)).toBe(true);
    expect(inv.has('apple', 4)).toBe(false);
  });

  it('fills partial stacks before opening new ones', () => {
    const inv = new Inventory();
    inv.add('apple', 6); // maxStack 8
    inv.add('apple', 4);
    // 10 apples across two stacks, not three.
    expect(inv.count('apple')).toBe(10);
    expect(inv.list().filter((s) => s.id === 'apple')).toHaveLength(2);
  });

  it('removes, and refuses to remove more than it has', () => {
    const inv = new Inventory();
    inv.add('bread', 2);
    expect(inv.remove('bread', 3)).toBe(false);
    expect(inv.count('bread')).toBe(2);
    expect(inv.remove('bread', 2)).toBe(true);
    expect(inv.count('bread')).toBe(0);
  });

  it('drops empty stacks rather than leaving zeroes', () => {
    const inv = new Inventory();
    inv.add('bread', 1);
    inv.remove('bread', 1);
    expect(inv.list()).toEqual([]);
  });

  it('ignores unknown items', () => {
    const inv = new Inventory();
    expect(inv.add('unobtainium', 1)).toEqual({ added: 0, overflow: 1 });
  });

  it('lists in a stable order', () => {
    const inv = new Inventory();
    inv.add('coffee', 1);
    inv.add('apple', 1);
    expect(inv.list().map((s) => s.id)).toEqual(['apple', 'coffee']);
  });
});

describe('slot limits are a cap, not a grind', () => {
  it('reports overflow instead of failing the whole add', () => {
    const inv = new Inventory(2);
    inv.add('grocery_bag', 1); // maxStack 1 -> one slot
    inv.add('bread', 5); // one slot
    const r = inv.add('soap', 4);
    expect(r.added).toBe(0);
    expect(r.overflow).toBe(4);
  });

  it('never blocks key, mission or vehicle-key items', () => {
    const inv = new Inventory(1);
    inv.add('bread', 5); // fills the only slot
    expect(inv.isFull).toBe(true);
    // Losing a quest item to a full bag is a bug report, not a challenge.
    expect(inv.add('house_key', 1).added).toBe(1);
    expect(inv.add('keys_scooter', 1).added).toBe(1);
    expect(inv.add('phone', 1).added).toBe(1);
  });

  it('does not count exempt items toward the limit', () => {
    const inv = new Inventory(DEFAULT_SLOT_LIMIT);
    inv.add('house_key', 1);
    inv.add('phone', 1);
    expect(inv.usedSlots).toBe(0);
  });
});

describe('inventory persistence', () => {
  it('round-trips through JSON', () => {
    const inv = new Inventory();
    inv.add('apple', 5);
    inv.add('bread', 2);
    inv.add('house_key', 1);

    const restored = new Inventory();
    restored.restore(inv.toJSON());
    expect(restored.count('apple')).toBe(5);
    expect(restored.count('bread')).toBe(2);
    expect(restored.count('house_key')).toBe(1);
  });

  it('drops items removed from the catalogue rather than resurrecting them', () => {
    const inv = new Inventory();
    inv.restore([{ id: 'sword_of_a_previous_build', count: 3 }, { id: 'apple', count: 2 }]);
    expect(inv.count('sword_of_a_previous_build')).toBe(0);
    expect(inv.count('apple')).toBe(2);
  });

  it('ignores non-positive counts', () => {
    const inv = new Inventory();
    inv.restore([{ id: 'apple', count: 0 }, { id: 'bread', count: -4 }]);
    expect(inv.list()).toEqual([]);
  });
});

describe('equipment migrates the wardrobe rather than replacing it', () => {
  it('projects equipped items to the outfit colours Player uses', () => {
    const eq = new Equipment();
    const outfit = eq.toOutfit();
    expect(outfit.shirt).toBe('#efede2');
    expect(outfit.trousers).toBe('#9b8fc7');
    expect(outfit.hat).toBe('#dcc177');
    expect(outfit.hatOn).toBe(true);
  });

  it('equips by colour, as the existing wardrobe panel does', () => {
    const eq = new Equipment();
    expect(eq.equipColour('shirt', '#cfe4d0')).toBe(true);
    expect(eq.toOutfit().shirt).toBe('#cfe4d0');
    expect(eq.equippedId('shirt')).toBe('shirt_mint');
  });

  it('refuses a colour no item paints', () => {
    const eq = new Equipment();
    expect(eq.equipColour('shirt', '#ff00ff')).toBe(false);
    expect(eq.toOutfit().shirt).toBe('#efede2');
  });

  it('refuses to equip clothing into the wrong slot', () => {
    const eq = new Equipment();
    expect(eq.equip('hat_red')).toBe(true);
    expect(eq.equippedId('hat')).toBe('hat_red');
    // Not clothing at all.
    expect(eq.equip('bread')).toBe(false);
  });

  it('keeps the hat-off choice', () => {
    const eq = new Equipment();
    eq.setHatOn(false);
    expect(eq.toOutfit().hatOn).toBe(false);
  });

  it('restores from an old colour-only save without losing the outfit', () => {
    const eq = new Equipment();
    // The shape saves used before equipment existed.
    eq.restore({ shirt: '#c3cfe0', trousers: '#4f5d70', hat: '#7ba46a', hatOn: false });
    expect(eq.equippedId('shirt')).toBe('shirt_slate');
    expect(eq.equippedId('trousers')).toBe('trousers_navy');
    expect(eq.equippedId('hat')).toBe('hat_green');
    expect(eq.toOutfit().hatOn).toBe(false);
  });

  it('round-trips through its own format', () => {
    const eq = new Equipment();
    eq.equip('shirt_rose');
    eq.setHatOn(false);
    const b = new Equipment();
    b.restore(eq.toJSON());
    expect(b.equippedId('shirt')).toBe('shirt_rose');
    expect(b.toOutfit().hatOn).toBe(false);
  });

  it('every clothing item in the catalogue has a slot and a colour', () => {
    for (const i of ITEMS.filter((x) => x.kind === 'clothing')) {
      expect(i.slot, i.id).toBeTruthy();
      expect(i.colour, i.id).toMatch(/^#[0-9a-f]{6}$/i);
    }
  });
});

describe('needs decay slowly and never punish hard', () => {
  it('takes the documented time to empty', () => {
    for (const id of NEED_IDS) {
      const n = new Needs();
      n.advance(DRAIN_MINUTES[id] * MINUTE);
      expect(n.value(id), id).toBeCloseTo(0, 5);
    }
  });

  it('is barely moved by a few minutes of play', () => {
    const n = new Needs();
    n.advance(5 * MINUTE);
    // Nothing should have dropped even a tenth in five minutes.
    for (const id of NEED_IDS) expect(n.value(id), id).toBeGreaterThan(0.9);
  });

  it('never goes below zero or above one', () => {
    const n = new Needs();
    n.advance(100 * HOUR);
    for (const id of NEED_IDS) expect(n.value(id)).toBe(0);
    n.restore('hunger', 5);
    expect(n.value('hunger')).toBe(1);
  });

  it('ignores nonsense input', () => {
    const n = new Needs();
    n.advance(Number.NaN);
    n.advance(-100);
    expect(n.value('hunger')).toBe(1);
  });
});

describe('needs accessibility', () => {
  it('a disabled need does not decay', () => {
    const n = new Needs();
    n.setEnabled('hunger', false);
    n.advance(DRAIN_MINUTES.hunger * MINUTE);
    expect(n.value('hunger')).toBe(1);
    expect(n.value('energy')).toBeLessThan(1);
  });

  it('disabling mid-run leaves the value where it was, not topped up', () => {
    const n = new Needs();
    n.advance(DRAIN_MINUTES.hunger * MINUTE * 0.5);
    const half = n.value('hunger');
    n.setEnabled('hunger', false);
    n.advance(10 * HOUR);
    expect(n.value('hunger')).toBeCloseTo(half, 5);
    // ...and resumes from there.
    n.setEnabled('hunger', true);
    n.advance(MINUTE);
    expect(n.value('hunger')).toBeLessThan(half);
  });

  it('a zero decay scale freezes everything', () => {
    const n = new Needs();
    n.configure({ decayScale: 0 });
    n.advance(10 * HOUR);
    for (const id of NEED_IDS) expect(n.value(id)).toBe(1);
  });

  it('a half scale halves the rate', () => {
    const full = new Needs();
    const half = new Needs();
    half.configure({ decayScale: 0.5 });
    full.advance(HOUR);
    half.advance(HOUR);
    expect(1 - half.value('hunger')).toBeCloseTo((1 - full.value('hunger')) / 2, 5);
  });

  it('a disabled need never contributes a penalty', () => {
    const n = new Needs();
    n.advance(10 * HOUR); // everything empty
    const before = n.modifiers().moveSpeed;
    for (const id of NEED_IDS) n.setEnabled(id, false);
    expect(n.modifiers().moveSpeed).toBe(1);
    expect(n.modifiers().moveSpeed).toBeGreaterThan(before);
    expect(n.modifiers().lacking).toEqual([]);
  });
});

describe('needs modifiers stay gentle', () => {
  it('the worst case is a mild slow, not a punishment', () => {
    const n = new Needs();
    n.advance(10 * HOUR);
    expect(n.modifiers().moveSpeed).toBeGreaterThanOrEqual(0.85);
  });

  it('reports what is lacking, worst first', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: 0.05, energy: 0.2, cleanliness: 1, mood: 1 });
    expect(n.modifiers().lacking).toEqual(['hunger', 'energy']);
  });

  it('a comfortable player gets a small bonus, not a big one', () => {
    const n = new Needs();
    expect(n.modifiers().recovery).toBeGreaterThan(1);
    expect(n.modifiers().recovery).toBeLessThan(1.5);
  });

  it('nothing is lacking while everything is above the low mark', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: LOW_MARK + 0.01, energy: 1, cleanliness: 1, mood: 1 });
    expect(n.modifiers().lacking).toEqual([]);
  });
});

describe('satisfying needs', () => {
  it('food restores what its catalogue entry says', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: 0.1, energy: 0.1, cleanliness: 0.1, mood: 0.1 });
    const bread = itemDef('bread')!;
    n.restoreMany(bread.restores!);
    expect(n.value('hunger')).toBeCloseTo(0.45, 5);
  });

  it('coffee helps energy and mood, not hunger', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: 0.5, energy: 0.5, cleanliness: 0.5, mood: 0.5 });
    n.restoreMany(itemDef('coffee')!.restores!);
    expect(n.value('energy')).toBeGreaterThan(0.5);
    expect(n.value('hunger')).toBe(0.5);
  });

  it('sleeping fills energy but does not feed you', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: 0.2, energy: 0.1, cleanliness: 0.5, mood: 0.5 });
    n.sleep();
    expect(n.value('energy')).toBe(1);
    expect(n.value('hunger')).toBe(0.2);
  });

  it('showering fills cleanliness', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: 1, energy: 1, cleanliness: 0.1, mood: 0.5 });
    n.shower();
    expect(n.value('cleanliness')).toBe(1);
  });

  it('round-trips through a save', () => {
    const n = new Needs();
    n.advance(30 * MINUTE);
    const b = new Needs();
    b.restoreFrom(n.toJSON());
    for (const id of NEED_IDS) expect(b.value(id)).toBeCloseTo(n.value(id), 8);
  });

  it('ignores a corrupt value on restore', () => {
    const n = new Needs();
    n.restoreFrom({ hunger: Number.NaN as number, energy: 0.5 } as Partial<Record<NeedId, number>>);
    expect(n.value('hunger')).toBe(1);
    expect(n.value('energy')).toBe(0.5);
  });
});
