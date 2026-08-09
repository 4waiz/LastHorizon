import type { NeedId } from './Needs';

/**
 * What the player is carrying, and wearing.
 *
 * Data-driven: items are catalogue entries, not classes, so adding a loaf of
 * bread is one object literal rather than a new type. The catalogue is the only
 * place that knows what an item *is*; the inventory only counts them.
 *
 * Deliberately not a survival grind. Slot limits exist so a player cannot carry
 * a shop, not to force inventory management — key and mission items are exempt
 * because losing a quest item to a full bag is a bug report, not a challenge.
 */

export type ItemKind =
  | 'stackable'
  | 'key'
  | 'clothing'
  | 'food'
  | 'ammo'
  | 'vehicleKey'
  | 'mission';

/** Where a piece of clothing sits. Mirrors the existing wardrobe slots. */
export type EquipSlot = 'shirt' | 'trousers' | 'hat';

export interface ItemDef {
  readonly id: string;
  readonly name: string;
  readonly kind: ItemKind;
  /** 1 for anything unique. */
  readonly maxStack: number;
  /** Clothing only: which slot it occupies, and the colour it paints. */
  readonly slot?: EquipSlot;
  readonly colour?: string;
  /** Food only: how much of each need it restores, 0..1. */
  readonly restores?: Partial<Record<NeedId, number>>;
}

/** Items exempt from slot limits: losing these to a full bag is a bug. */
const EXEMPT: ReadonlySet<ItemKind> = new Set<ItemKind>(['key', 'mission', 'vehicleKey']);

export const DEFAULT_SLOT_LIMIT = 16;

// ---------------------------------------------------------------------------
// Catalogue
// ---------------------------------------------------------------------------

function clothing(id: string, name: string, slot: EquipSlot, colour: string): ItemDef {
  return { id, name, kind: 'clothing', maxStack: 1, slot, colour };
}

/**
 * The starting catalogue.
 *
 * Clothing mirrors the six shirt, six trouser and five hat colours the
 * wardrobe already offers, so the existing choices become items rather than
 * being replaced by them.
 */
export const ITEMS: readonly ItemDef[] = [
  // Clothing — colours carried over from the wardrobe panel.
  clothing('shirt_cream', 'Cream shirt', 'shirt', '#efede2'),
  clothing('shirt_sand', 'Sand shirt', 'shirt', '#e4d3b8'),
  clothing('shirt_sky', 'Sky shirt', 'shirt', '#cfe0ee'),
  clothing('shirt_rose', 'Rose shirt', 'shirt', '#e5cdd6'),
  clothing('shirt_mint', 'Mint shirt', 'shirt', '#cfe4d0'),
  clothing('shirt_slate', 'Slate shirt', 'shirt', '#c3cfe0'),

  clothing('trousers_violet', 'Violet trousers', 'trousers', '#9b8fc7'),
  clothing('trousers_olive', 'Olive trousers', 'trousers', '#8a9b58'),
  clothing('trousers_steel', 'Steel trousers', 'trousers', '#8892a3'),
  clothing('trousers_clay', 'Clay trousers', 'trousers', '#b08a63'),
  clothing('trousers_navy', 'Navy trousers', 'trousers', '#4f5d70'),
  clothing('trousers_mauve', 'Mauve trousers', 'trousers', '#c0a3b8'),

  clothing('hat_straw', 'Straw hat', 'hat', '#dcc177'),
  clothing('hat_red', 'Red cap', 'hat', '#c8544a'),
  clothing('hat_blue', 'Blue cap', 'hat', '#6f9ec9'),
  clothing('hat_green', 'Green cap', 'hat', '#7ba46a'),
  clothing('hat_pale', 'Pale cap', 'hat', '#e6e2d6'),

  // Food. Restores are modest on purpose: eating is a small top-up, not a
  // mechanic the player has to plan around.
  { id: 'bread', name: 'Bread', kind: 'food', maxStack: 5, restores: { hunger: 0.35 } },
  { id: 'apple', name: 'Apple', kind: 'food', maxStack: 8, restores: { hunger: 0.18, mood: 0.05 } },
  { id: 'coffee', name: 'Coffee', kind: 'food', maxStack: 3, restores: { energy: 0.3, mood: 0.08 } },
  { id: 'tea', name: 'Tea', kind: 'food', maxStack: 3, restores: { energy: 0.18, mood: 0.12 } },
  { id: 'meal', name: 'Hot meal', kind: 'food', maxStack: 2, restores: { hunger: 0.6, mood: 0.15 } },
  { id: 'soap', name: 'Soap', kind: 'stackable', maxStack: 4, restores: { cleanliness: 0.5 } },

  // Phase 7. Caught rather than bought; the grocery and the cafe take them.
  { id: 'fish_small', name: 'Small fish', kind: 'food', maxStack: 6, restores: { hunger: 0.25 } },
  { id: 'fish_large', name: 'Large fish', kind: 'food', maxStack: 3, restores: { hunger: 0.5 } },

  // Job goods. A parcel is deliberately `stackable`, not `mission` — losing a
  // courier run to a full bag is a job you failed, not a quest you broke.
  { id: 'parcel', name: 'Parcel', kind: 'stackable', maxStack: 4 },
  { id: 'stock_box', name: 'Stock box', kind: 'stackable', maxStack: 3 },
  { id: 'repair_kit', name: 'Repair kit', kind: 'stackable', maxStack: 2 },

  // Apartment decorations. Each names a kit part; see DECOR_PARTS.
  { id: 'decor_plant', name: 'Potted plant', kind: 'stackable', maxStack: 3 },
  { id: 'decor_shelf', name: 'Bookshelf', kind: 'stackable', maxStack: 3 },
  { id: 'decor_table', name: 'Side table', kind: 'stackable', maxStack: 3 },

  // Everything else.
  { id: 'grocery_bag', name: 'Grocery bag', kind: 'stackable', maxStack: 1 },
  { id: 'phone', name: 'Phone', kind: 'key', maxStack: 1 },
  { id: 'house_key', name: 'House key', kind: 'key', maxStack: 1 },
  // One per vehicle that asks for a key. `vehicleDefinition.test.ts` checks
  // every `ownership.keyItem` resolves here — a key that does not exist is a
  // vehicle nobody can ever get into, and it fails silently at the door.
  { id: 'keys_bicycle', name: 'Bicycle', kind: 'vehicleKey', maxStack: 1 },
  { id: 'keys_scooter', name: 'Scooter key', kind: 'vehicleKey', maxStack: 1 },
  { id: 'keys_hatchback', name: 'Car key', kind: 'vehicleKey', maxStack: 1 },
  { id: 'keys_van', name: 'Van key', kind: 'vehicleKey', maxStack: 1 },
  { id: 'keys_police', name: 'Patrol car key', kind: 'vehicleKey', maxStack: 1 },
  { id: 'ammo_pistol', name: 'Pistol rounds', kind: 'ammo', maxStack: 60 },
];

const BY_ID = new Map(ITEMS.map((i) => [i.id, i]));

export function itemDef(id: string): ItemDef | null {
  return BY_ID.get(id) ?? null;
}

export interface StackData {
  id: string;
  count: number;
}

export interface AddResult {
  /** How many actually went in. */
  added: number;
  /** How many did not fit. */
  overflow: number;
}

// ---------------------------------------------------------------------------
// Inventory
// ---------------------------------------------------------------------------

export class Inventory {
  private stacks: StackData[] = [];

  constructor(readonly slotLimit: number = DEFAULT_SLOT_LIMIT) {}

  /** Slots in use. Exempt kinds do not count. */
  get usedSlots(): number {
    return this.stacks.filter((s) => {
      const def = itemDef(s.id);
      return def !== null && !EXEMPT.has(def.kind);
    }).length;
  }

  get isFull(): boolean {
    return this.usedSlots >= this.slotLimit;
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.stacks) if (s.id === id) n += s.count;
    return n;
  }

  has(id: string, atLeast = 1): boolean {
    return this.count(id) >= atLeast;
  }

  /** Every stack, in a stable order. */
  list(): readonly StackData[] {
    return [...this.stacks].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  /**
   * Add items, filling partial stacks before opening new ones.
   *
   * Returns what did not fit rather than throwing: a shop that sells five
   * loaves to a player with room for two should sell two, not fail.
   */
  add(id: string, count = 1): AddResult {
    const def = itemDef(id);
    if (!def || count <= 0) return { added: 0, overflow: Math.max(0, count) };

    let left = count;

    for (const stack of this.stacks) {
      if (stack.id !== id || stack.count >= def.maxStack) continue;
      const room = def.maxStack - stack.count;
      const take = Math.min(room, left);
      stack.count += take;
      left -= take;
      if (left === 0) return { added: count, overflow: 0 };
    }

    const exempt = EXEMPT.has(def.kind);
    while (left > 0) {
      if (!exempt && this.isFull) break;
      const take = Math.min(def.maxStack, left);
      this.stacks.push({ id, count: take });
      left -= take;
    }

    return { added: count - left, overflow: left };
  }

  /** Remove items. Returns false and changes nothing if there are too few. */
  remove(id: string, count = 1): boolean {
    if (count <= 0) return true;
    if (this.count(id) < count) return false;

    let left = count;
    for (const stack of this.stacks) {
      if (stack.id !== id) continue;
      const take = Math.min(stack.count, left);
      stack.count -= take;
      left -= take;
      if (left === 0) break;
    }
    this.stacks = this.stacks.filter((s) => s.count > 0);
    return true;
  }

  clear(): void {
    this.stacks = [];
  }

  toJSON(): StackData[] {
    return this.list().map((s) => ({ ...s }));
  }

  /**
   * Restore from a save. Unknown ids are dropped rather than trusted — an item
   * removed from the catalogue in a later build must not resurrect as a
   * phantom stack.
   */
  restore(data: readonly StackData[]): void {
    this.stacks = [];
    for (const s of data) {
      if (!itemDef(s.id) || s.count <= 0) continue;
      this.add(s.id, s.count);
    }
  }
}

// ---------------------------------------------------------------------------
// Equipment
// ---------------------------------------------------------------------------

/** The shape `Player` already uses for its outfit. */
export interface OutfitColours {
  shirt: string;
  trousers: string;
  hat: string;
  hatOn: boolean;
}

export const DEFAULT_EQUIPPED: Readonly<Record<EquipSlot, string>> = {
  shirt: 'shirt_cream',
  trousers: 'trousers_violet',
  hat: 'hat_straw',
};

export interface EquipmentData {
  shirt: string;
  trousers: string;
  hat: string;
  hatOn: boolean;
}

/**
 * What is worn.
 *
 * Kept as item ids, and projected to colours on demand. The wardrobe panel
 * still deals in colours and `Player` still takes an outfit, so this migrates
 * the existing choices rather than replacing them.
 */
export class Equipment {
  private equipped: Record<EquipSlot, string> = { ...DEFAULT_EQUIPPED };
  private hatOnValue = true;

  get hatOn(): boolean {
    return this.hatOnValue;
  }

  setHatOn(on: boolean): void {
    this.hatOnValue = on;
  }

  equippedId(slot: EquipSlot): string {
    return this.equipped[slot];
  }

  /** Equip by item id. Rejects anything that is not clothing for that slot. */
  equip(id: string): boolean {
    const def = itemDef(id);
    if (!def || def.kind !== 'clothing' || !def.slot) return false;
    this.equipped[def.slot] = id;
    return true;
  }

  /**
   * Equip by colour, for the existing wardrobe panel.
   *
   * The panel sends a hex value; this finds the catalogue item that paints it
   * so the two representations cannot drift apart.
   */
  equipColour(slot: EquipSlot, colour: string): boolean {
    const match = ITEMS.find(
      (i) => i.slot === slot && i.colour?.toLowerCase() === colour.toLowerCase(),
    );
    if (!match) return false;
    this.equipped[slot] = match.id;
    return true;
  }

  /** Colours for `Player.setOutfit`. */
  toOutfit(): OutfitColours {
    return {
      shirt: itemDef(this.equipped.shirt)?.colour ?? '#efede2',
      trousers: itemDef(this.equipped.trousers)?.colour ?? '#9b8fc7',
      hat: itemDef(this.equipped.hat)?.colour ?? '#dcc177',
      hatOn: this.hatOnValue,
    };
  }

  toJSON(): EquipmentData {
    return { ...this.equipped, hatOn: this.hatOnValue };
  }

  /**
   * Restore from a save.
   *
   * Accepts both shapes: item ids from this system, and raw hex colours from
   * saves written before the migration. A save that predates equipment must
   * not lose the outfit the player chose.
   */
  restore(data: Partial<EquipmentData> | OutfitColours): void {
    for (const slot of ['shirt', 'trousers', 'hat'] as const) {
      const value = (data as Record<string, unknown>)[slot];
      if (typeof value !== 'string') continue;
      if (value.startsWith('#')) this.equipColour(slot, value);
      else this.equip(value);
    }
    if (typeof data.hatOn === 'boolean') this.hatOnValue = data.hatOn;
  }
}
