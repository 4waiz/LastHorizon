/**
 * What each counter will do for you.
 *
 * An offer is data: a label, an effect and the conditions under which it can
 * run. `ServiceSystem` executes it. Keeping the two apart means the menu the
 * player sees is generated from the same list that the executor switches on,
 * so a button can never exist for an effect nobody implemented — and the
 * "greyed out with a reason" state comes free rather than being a second
 * hand-maintained list.
 *
 * Every service id here is referenced by an `InteriorPoint.service` in
 * `interiorCatalog.ts`, and `serviceCatalog.test.ts` checks the two agree in
 * both directions.
 */

import { SERVICE_FEES, VEHICLE_PRICES } from '../economy/PriceCatalog';

export type OfferEffect =
  /** Buy a listed item from this shop's stock. */
  | { readonly kind: 'buy'; readonly itemId: string; readonly count: number }
  /** Sell everything of a kind that the player is carrying. */
  | { readonly kind: 'sellAll'; readonly itemId: string }
  /** A flat fee with no goods: fine, treatment, respray, recovery. */
  | { readonly kind: 'fee'; readonly fee: keyof typeof SERVICE_FEES }
  /** Clinic: restore needs and clear the injured state. */
  | { readonly kind: 'treat' }
  /** Buy a vehicle of this kind. */
  | { readonly kind: 'vehicleBuy'; readonly vehicleKind: string }
  /** Repair the selected vehicle; price depends on its condition. */
  | { readonly kind: 'vehicleRepair' }
  | { readonly kind: 'vehicleRecolour' }
  | { readonly kind: 'vehicleRecover' }
  | { readonly kind: 'vehicleSelect' }
  /** Physical interactions the host performs. */
  | { readonly kind: 'sleep' }
  | { readonly kind: 'shower' }
  | { readonly kind: 'save' }
  | { readonly kind: 'decorate'; readonly itemId: string }
  /** Eat or drink something on the spot, without pocketing it first. */
  | { readonly kind: 'consumeHere'; readonly itemId: string }
  /** Talk to somebody. The dialogue data path already exists. */
  | { readonly kind: 'talk'; readonly topic: string }
  /** Sign up for a job. */
  | { readonly kind: 'startTask'; readonly taskId: string };

export interface OfferDef {
  readonly id: string;
  readonly label: string;
  readonly effect: OfferEffect;
  /** Adult-stage gate. Ammunition is the only thing that uses it. */
  readonly minAge?: number;
  readonly detail?: string;
}

export interface ServiceDef {
  readonly id: string;
  readonly title: string;
  readonly offers: readonly OfferDef[];
}

const buy = (itemId: string, label: string, count = 1): OfferDef => ({
  id: `buy_${itemId}${count > 1 ? `_x${count}` : ''}`,
  label,
  effect: { kind: 'buy', itemId, count },
});

export const SERVICES: readonly ServiceDef[] = [
  {
    id: 'grocery_buy',
    title: 'Village grocery',
    offers: [
      buy('bread', 'Bread'),
      buy('apple', 'Apples', 4),
      buy('coffee', 'Coffee'),
      buy('meal', 'Hot meal'),
      buy('soap', 'Soap'),
      buy('grocery_bag', 'Grocery bag'),
      { id: 'sell_fish', label: 'Sell your catch', effect: { kind: 'sellAll', itemId: 'fish_small' } },
      { id: 'sell_fish_big', label: 'Sell the big one', effect: { kind: 'sellAll', itemId: 'fish_large' } },
    ],
  },
  {
    id: 'cafe_order',
    title: 'Corner cafe',
    offers: [
      { id: 'drink_coffee', label: 'Coffee, here', effect: { kind: 'consumeHere', itemId: 'coffee' } },
      { id: 'drink_tea', label: 'Tea, here', effect: { kind: 'consumeHere', itemId: 'tea' } },
      { id: 'eat_meal', label: 'Sit down to a meal', effect: { kind: 'consumeHere', itemId: 'meal' } },
      buy('coffee', 'Coffee to take away'),
      { id: 'chat', label: 'Talk to whoever is in', effect: { kind: 'talk', topic: 'cafe' } },
    ],
  },
  {
    id: 'clothing_buy',
    title: 'Clothing shop',
    offers: [
      buy('shirt_sky', 'Sky shirt'),
      buy('shirt_mint', 'Mint shirt'),
      buy('shirt_slate', 'Slate shirt'),
      buy('trousers_olive', 'Olive trousers'),
      buy('trousers_navy', 'Navy trousers'),
      buy('hat_red', 'Red cap'),
      buy('hat_green', 'Green cap'),
    ],
  },
  {
    id: 'clothing_try',
    title: 'Fitting room',
    offers: [{ id: 'try_on', label: 'Try something on', effect: { kind: 'talk', topic: 'fitting' } }],
  },
  {
    id: 'clinic_treat',
    title: 'Village clinic',
    offers: [
      { id: 'treatment', label: 'Get patched up', effect: { kind: 'treat' }, detail: 'Restores health and rest.' },
      { id: 'advice', label: 'Ask the nurse', effect: { kind: 'talk', topic: 'clinic' } },
    ],
  },
  {
    id: 'police_desk',
    title: 'Front desk',
    offers: [
      { id: 'pay_fine', label: 'Pay your fine', effect: { kind: 'fee', fee: 'fine' } },
      { id: 'report', label: 'Speak to the sergeant', effect: { kind: 'talk', topic: 'police' } },
      // The only age-gated offer in the game. Phase 9 owns what it is for.
      { id: 'buy_ammo', label: 'Range ammunition', effect: { kind: 'buy', itemId: 'ammo_pistol', count: 10 }, minAge: 18 },
    ],
  },
  {
    id: 'garage_desk',
    title: 'Garage and forecourt',
    offers: [
      ...Object.keys(VEHICLE_PRICES).map(
        (kind): OfferDef => ({
          id: `buy_vehicle_${kind}`,
          label: `Buy the ${kind}`,
          effect: { kind: 'vehicleBuy', vehicleKind: kind },
        }),
      ),
      { id: 'repair', label: 'Repair it', effect: { kind: 'vehicleRepair' } },
      { id: 'recolour', label: 'Respray it', effect: { kind: 'vehicleRecolour' } },
      { id: 'recover', label: 'Recover a stranded vehicle', effect: { kind: 'vehicleRecover' } },
      { id: 'select', label: 'Bring one round', effect: { kind: 'vehicleSelect' } },
      buy('repair_kit', 'Repair kit'),
    ],
  },
  {
    id: 'apartment_save',
    title: 'Your desk',
    offers: [{ id: 'write', label: 'Write the day down', effect: { kind: 'save' } }],
  },
  {
    id: 'home_save',
    title: 'The desk',
    offers: [{ id: 'write', label: 'Write the day down', effect: { kind: 'save' } }],
  },
  {
    id: 'apartment_decorate',
    title: 'Make it yours',
    offers: [
      { id: 'decor_plant', label: 'Put out a plant', effect: { kind: 'decorate', itemId: 'decor_plant' } },
      { id: 'decor_shelf', label: 'Put up a shelf', effect: { kind: 'decorate', itemId: 'decor_shelf' } },
      { id: 'decor_table', label: 'Add a side table', effect: { kind: 'decorate', itemId: 'decor_table' } },
      buy('decor_plant', 'Buy a plant'),
      buy('decor_shelf', 'Buy a bookshelf'),
      buy('decor_table', 'Buy a side table'),
    ],
  },
  {
    id: 'airstrip_log',
    title: 'Flight log',
    offers: [
      { id: 'courier', label: 'Take a courier run', effect: { kind: 'startTask', taskId: 'job_city_courier' } },
      { id: 'ask', label: 'Ask about the strip', effect: { kind: 'talk', topic: 'airstrip' } },
    ],
  },
];

const BY_ID = new Map(SERVICES.map((s) => [s.id, s]));

export function serviceDef(id: string): ServiceDef | null {
  return BY_ID.get(id) ?? null;
}

/** Item ids that decorate an apartment slot, and the kit part each becomes. */
export const DECOR_PARTS = {
  decor_plant: 'KitPlanter',
  decor_shelf: 'KitShelf',
  decor_table: 'KitTable',
} as const;

export type DecorItemId = keyof typeof DECOR_PARTS;

export function isDecorItem(id: string): id is DecorItemId {
  return id in DECOR_PARTS;
}
