/**
 * What things cost.
 *
 * One table, so a price can be looked up, balanced and tested in one place
 * rather than being scattered across nine shop implementations. The numbers
 * themselves are argued for in `docs/ECONOMY_BALANCE.md`; what this file
 * enforces is the shape:
 *
 * - **Sell is always below buy.** `priceCatalog.test.ts` asserts it for every
 *   entry. A single inverted pair is an infinite money loop — buy from the
 *   shop, sell back to the same shop, repeat — and it is the classic way a
 *   game economy dies.
 * - **Everything is a whole number of dollars.** See `Wallet`.
 * - **A shop stocks a named list.** A grocery that will sell you a car
 *   because the price table happens to contain one is not a grocery.
 */

import type { ServiceType } from '../world/interiors/InteriorDefinition';

export interface PriceEntry {
  readonly id: string;
  /** What the player pays. */
  readonly buy: number;
  /** What the player receives selling one back. Always less than `buy`. */
  readonly sell: number;
}

/**
 * Item prices.
 *
 * Margins are wide on cheap goods and narrow on expensive ones, which is both
 * how retail actually works and what stops the player grinding a 5% spread on
 * bread. Clothing resells at a third: worn is worn.
 */
export const ITEM_PRICES: readonly PriceEntry[] = [
  // Food and sundries — pocket change, bought often.
  { id: 'bread', buy: 3, sell: 1 },
  { id: 'apple', buy: 2, sell: 1 },
  { id: 'coffee', buy: 4, sell: 1 },
  { id: 'tea', buy: 3, sell: 1 },
  { id: 'meal', buy: 9, sell: 3 },
  { id: 'soap', buy: 3, sell: 1 },
  { id: 'grocery_bag', buy: 2, sell: 1 },

  // Caught, not bought. Buy prices exist so the catalogue has no holes, but
  // no shop stocks them — see SHOP_STOCK.
  { id: 'fish_small', buy: 9, sell: 6 },
  { id: 'fish_large', buy: 20, sell: 14 },

  // Clothing.
  { id: 'shirt_cream', buy: 18, sell: 6 },
  { id: 'shirt_sand', buy: 18, sell: 6 },
  { id: 'shirt_sky', buy: 20, sell: 7 },
  { id: 'shirt_rose', buy: 20, sell: 7 },
  { id: 'shirt_mint', buy: 22, sell: 7 },
  { id: 'shirt_slate', buy: 22, sell: 7 },
  { id: 'trousers_violet', buy: 26, sell: 9 },
  { id: 'trousers_olive', buy: 24, sell: 8 },
  { id: 'trousers_steel', buy: 24, sell: 8 },
  { id: 'trousers_clay', buy: 26, sell: 9 },
  { id: 'trousers_navy', buy: 28, sell: 9 },
  { id: 'trousers_mauve', buy: 28, sell: 9 },
  { id: 'hat_straw', buy: 14, sell: 5 },
  { id: 'hat_red', buy: 15, sell: 5 },
  { id: 'hat_blue', buy: 15, sell: 5 },
  { id: 'hat_green', buy: 16, sell: 5 },
  { id: 'hat_pale', buy: 16, sell: 5 },

  // Adult stage only. The gate lives in the service, not the price table.
  { id: 'ammo_pistol', buy: 2, sell: 1 },
  // Shells cost more per shot and there are fewer of them; carbine rounds are
  // cheap by the round and expensive by the magazine, which is what makes the
  // carbine the weapon you think twice about emptying.
  { id: 'ammo_shotgun', buy: 4, sell: 1 },
  { id: 'ammo_carbine', buy: 3, sell: 1 },

  // Trade goods.
  { id: 'repair_kit', buy: 45, sell: 18 },
  { id: 'stock_box', buy: 12, sell: 5 },
  { id: 'parcel', buy: 6, sell: 2 },

  // Decorations for the apartment.
  { id: 'decor_plant', buy: 34, sell: 12 },
  { id: 'decor_shelf', buy: 58, sell: 20 },
  { id: 'decor_table', buy: 72, sell: 25 },
];

const BY_ID = new Map(ITEM_PRICES.map((p) => [p.id, p]));

export function priceOf(id: string): PriceEntry | null {
  return BY_ID.get(id) ?? null;
}

export function buyPrice(id: string): number | null {
  return BY_ID.get(id)?.buy ?? null;
}

export function sellPrice(id: string): number | null {
  return BY_ID.get(id)?.sell ?? null;
}

/**
 * What each shop actually carries.
 *
 * Keyed on the interior's service type, so a new grocery in a second town
 * inherits the stock list rather than restating it.
 */
export const SHOP_STOCK: Readonly<Partial<Record<ServiceType, readonly string[]>>> = {
  grocery: ['bread', 'apple', 'coffee', 'tea', 'soap', 'grocery_bag', 'meal'],
  cafe: ['coffee', 'tea', 'meal'],
  clothing: [
    'shirt_cream',
    'shirt_sand',
    'shirt_sky',
    'shirt_rose',
    'shirt_mint',
    'shirt_slate',
    'trousers_violet',
    'trousers_olive',
    'trousers_steel',
    'trousers_clay',
    'trousers_navy',
    'trousers_mauve',
    'hat_straw',
    'hat_red',
    'hat_blue',
    'hat_green',
    'hat_pale',
  ],
  garage: ['repair_kit'],
  police: ['ammo_pistol', 'ammo_shotgun', 'ammo_carbine'],
  apartment: ['decor_plant', 'decor_shelf', 'decor_table'],
};

/** What each shop will take off your hands. */
export const SHOP_BUYS: Readonly<Partial<Record<ServiceType, readonly string[]>>> = {
  grocery: ['fish_small', 'fish_large', 'apple', 'bread'],
  cafe: ['fish_small', 'fish_large'],
  clothing: [
    'shirt_cream',
    'shirt_sand',
    'shirt_sky',
    'shirt_rose',
    'shirt_mint',
    'shirt_slate',
    'trousers_violet',
    'trousers_olive',
    'trousers_steel',
    'trousers_clay',
    'trousers_navy',
    'trousers_mauve',
    'hat_straw',
    'hat_red',
    'hat_blue',
    'hat_green',
    'hat_pale',
  ],
  garage: ['repair_kit'],
};

export function stocks(service: ServiceType, itemId: string): boolean {
  return (SHOP_STOCK[service] ?? []).includes(itemId);
}

export function buysBack(service: ServiceType, itemId: string): boolean {
  return (SHOP_BUYS[service] ?? []).includes(itemId);
}

// ---------------------------------------------------------------------------
// Services priced by the job rather than by the item
// ---------------------------------------------------------------------------

/** Vehicles the dealership sells, by the kind `VehicleRegistry` knows. */
export const VEHICLE_PRICES: Readonly<Record<string, number>> = {
  bicycle: 180,
  scooter: 950,
  hatchback: 4200,
  van: 6800,
  // The patrol car is deliberately absent. A police vehicle you can buy is a
  // police vehicle the player drives through the story missions in Phase 9.
};

export function vehiclePrice(kind: string): number | null {
  return VEHICLE_PRICES[kind] ?? null;
}

/**
 * Repairing a vehicle from `condition` (0..1) back to full.
 *
 * Linear in the damage, with a call-out fee so a scratch is not free. Rounded
 * up, so the player is never charged a fraction of a dollar and never repairs
 * a dented car for nothing.
 */
export const REPAIR_FULL_COST = 320;
export const REPAIR_CALLOUT = 15;

export function repairCost(condition: number): number {
  const damage = Math.min(1, Math.max(0, 1 - condition));
  if (damage <= 0) return 0;
  return REPAIR_CALLOUT + Math.ceil(damage * REPAIR_FULL_COST);
}

export const SERVICE_FEES = {
  /** Respray, any colour in the garage's palette. */
  recolour: 120,
  /** Bring a lost, flipped or impounded vehicle back to the forecourt. */
  recovery: 85,
  /** A visit to the clinic. Restores needs and clears the injured state. */
  treatment: 45,
  /** The placeholder fine Phase 9 will start issuing for real. */
  fine: 60,
  /** Apartment rent, charged every RENT_PERIOD_DAYS. */
  rent: 180,
  /** A cup of something and a sit down. */
  cafeSitting: 2,
} as const;

export const RENT_PERIOD_DAYS = 7;

/**
 * What the repeatable jobs pay.
 *
 * Base rates. `TaskSystem` scales them by difficulty, which is what keeps a
 * courier run across the city worth more than one across a village square
 * without needing a second table.
 */
export const JOB_PAY = {
  job_grocery_shift: 45,
  job_parcel_delivery: 30,
  job_city_courier: 55,
  job_taxi_driving: 12,
  job_garage_recovery: 70,
  activity_fishing: 0,
} as const;

export type JobId = keyof typeof JOB_PAY;
