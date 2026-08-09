import { beforeEach, describe, expect, it } from 'vitest';
import { Economy } from '../src/economy/Economy';
import { SERVICE_FEES, buyPrice, repairCost, vehiclePrice } from '../src/economy/PriceCatalog';
import { Inventory } from '../src/player/Inventory';
import { Needs } from '../src/player/Needs';
import {
  DECOR_PARTS,
  SERVICES,
  isDecorItem,
  serviceDef,
} from '../src/services/ServiceCatalog';
import {
  buildMenu,
  executeOffer,
  type ServiceHost,
} from '../src/services/ServiceSystem';
import { INTERIORS } from '../src/world/interiors/interiorCatalog';
import { KIT_PARTS } from '../src/world/interiors/InteriorKit';
import type { ServiceType } from '../src/world/interiors/InteriorDefinition';

const AT = 1_700_000_000_000;

interface Harness extends ServiceHost {
  calls: string[];
}

function host(overrides: Partial<ServiceHost> & { cash?: number } = {}): Harness {
  const inventory = overrides.inventory ?? new Inventory(16);
  const economy = overrides.economy ?? new Economy(inventory, overrides.cash ?? 1000);
  const calls: string[] = [];
  return {
    economy,
    inventory,
    needs: overrides.needs ?? new Needs(),
    age: overrides.age ?? 30,
    now: AT,
    service: overrides.service ?? 'grocery',
    open: overrides.open ?? true,
    selectedVehicle: overrides.selectedVehicle ?? null,
    ownedVehicles: overrides.ownedVehicles ?? [],
    calls,
    buyVehicle: (k) => (calls.push(`buy:${k}`), true),
    repairVehicle: (id) => (calls.push(`repair:${id}`), true),
    recolourVehicle: (id) => (calls.push(`recolour:${id}`), true),
    recoverVehicle: (id) => (calls.push(`recover:${id}`), true),
    selectVehicle: (id) => (calls.push(`select:${id}`), true),
    saveGame: () => calls.push('save'),
    sleep: () => calls.push('sleep'),
    shower: () => calls.push('shower'),
    placeDecor: (i) => (calls.push(`decor:${i}`), true),
    talk: (t) => calls.push(`talk:${t}`),
    startTask: (t) => (calls.push(`task:${t}`), true),
    treat: () => calls.push('treat'),
    ...overrides,
  } as Harness;
}

describe('service catalogue', () => {
  it('defines a service for every point that names one', () => {
    for (const def of INTERIORS) {
      for (const p of def.points) {
        if (!p.service) continue;
        expect(serviceDef(p.service), `${def.id}/${p.id} -> ${p.service}`).not.toBeNull();
      }
    }
  });

  it('has every service reachable from some interior', () => {
    const referenced = new Set(
      INTERIORS.flatMap((d) => d.points.map((p) => p.service).filter(Boolean)),
    );
    for (const s of SERVICES) {
      expect(referenced.has(s.id), `${s.id} is unreachable`).toBe(true);
    }
  });

  it('has no duplicate offer ids within a service', () => {
    for (const s of SERVICES) {
      const ids = s.offers.map((o) => o.id);
      expect(new Set(ids).size, s.id).toBe(ids.length);
    }
  });

  it('maps every decoration to a real kit part', () => {
    for (const [item, part] of Object.entries(DECOR_PARTS)) {
      expect(isDecorItem(item)).toBe(true);
      expect(KIT_PARTS).toContain(part);
    }
  });

  it('age-gates ammunition and nothing else', () => {
    const gated = SERVICES.flatMap((s) =>
      s.offers.filter((o) => o.minAge !== undefined).map((o) => o.id),
    );
    expect(gated).toEqual(['buy_ammo']);
  });
});

describe('menus', () => {
  it('lists unaffordable offers rather than hiding them', () => {
    const menu = buildMenu('grocery_buy', host({ cash: 0 }))!;
    expect(menu.entries.length).toBeGreaterThan(0);
    const bread = menu.entries.find((e) => e.id === 'buy_bread')!;
    expect(bread.available).toBe(false);
    expect(bread.reason).toBe('Not enough cash');
    expect(bread.price).toBe(buyPrice('bread'));
  });

  it('disables everything when the shop is shut', () => {
    const menu = buildMenu('grocery_buy', host({ open: false }))!;
    expect(menu.open).toBe(false);
    expect(menu.entries.every((e) => !e.available)).toBe(true);
    expect(menu.entries.every((e) => e.reason === 'Closed')).toBe(true);
  });

  it('greys out ammunition for a child and explains why', () => {
    const menu = buildMenu('police_desk', host({ age: 12, service: 'police' }))!;
    const ammo = menu.entries.find((e) => e.id === 'buy_ammo')!;
    expect(ammo.available).toBe(false);
    expect(ammo.reason).toBe('Ages 18 and over');
  });

  it('prices a repair from the vehicle in front of it', () => {
    const h = host({
      service: 'garage',
      selectedVehicle: { id: 'v1', kind: 'hatchback', condition: 0.4, label: 'Hatchback' },
    });
    const entry = buildMenu('garage_desk', h)!.entries.find((e) => e.id === 'repair')!;
    expect(entry.price).toBe(repairCost(0.4));
  });

  it('will not offer a repair with nothing to fix', () => {
    const h = host({
      service: 'garage',
      selectedVehicle: { id: 'v1', kind: 'hatchback', condition: 1, label: 'Hatchback' },
    });
    const entry = buildMenu('garage_desk', h)!.entries.find((e) => e.id === 'repair')!;
    expect(entry.available).toBe(false);
    expect(entry.reason).toBe('Nothing to fix');
  });

  it('says the bag is full rather than not enough cash', () => {
    const inv = new Inventory(1);
    inv.add('shirt_cream', 1);
    const h = host({ inventory: inv, economy: new Economy(inv, 9999), service: 'grocery' });
    const entry = buildMenu('grocery_buy', h)!.entries.find((e) => e.id === 'buy_bread')!;
    expect(entry.reason).toBe('Bag is full');
  });

  it('returns null for a service that does not exist', () => {
    expect(buildMenu('nope', host())).toBeNull();
  });
});

describe('executing offers', () => {
  let h: Harness;

  beforeEach(() => {
    h = host();
  });

  it('buys an item and charges for it', () => {
    const r = executeOffer('grocery_buy', 'buy_bread', h);
    expect(r.ok).toBe(true);
    expect(h.inventory.count('bread')).toBe(1);
    expect(h.economy.wallet.cash).toBe(1000 - buyPrice('bread')!);
  });

  it('refuses everything while closed', () => {
    const shut = host({ open: false });
    expect(executeOffer('grocery_buy', 'buy_bread', shut)).toEqual({ ok: false, reason: 'closed' });
    expect(shut.economy.wallet.cash).toBe(1000);
  });

  it('refuses an age-gated offer to a child, and takes nothing', () => {
    const kid = host({ age: 10, service: 'police' });
    expect(executeOffer('police_desk', 'buy_ammo', kid)).toEqual({
      ok: false,
      reason: 'too-young',
    });
    expect(kid.economy.wallet.cash).toBe(1000);
    expect(kid.inventory.count('ammo_pistol')).toBe(0);
  });

  it('sells the whole stack of a catch', () => {
    h.inventory.add('fish_small', 4);
    const r = executeOffer('grocery_buy', 'sell_fish', h);
    expect(r.ok).toBe(true);
    expect(h.inventory.count('fish_small')).toBe(0);
    expect(h.economy.wallet.cash).toBeGreaterThan(1000);
  });

  it('refuses to sell nothing', () => {
    expect(executeOffer('grocery_buy', 'sell_fish', h)).toEqual({
      ok: false,
      reason: 'nothing-to-sell',
    });
  });

  /**
   * A coffee at the counter must not need a free slot. This is the case that
   * makes `consumeHere` a separate effect rather than buy-then-eat.
   */
  it('serves a coffee at the counter with a full bag', () => {
    const inv = new Inventory(1);
    inv.add('shirt_cream', 1);
    const cafe = host({
      inventory: inv,
      economy: new Economy(inv, 100),
      service: 'cafe',
    });
    const before = cafe.needs.value('energy');
    cafe.needs.restore('energy', -1); // no-op; establish a low value below
    cafe.needs.restoreFrom({ energy: 0.2 });

    const r = executeOffer('cafe_order', 'drink_coffee', cafe);
    expect(r.ok).toBe(true);
    expect(cafe.needs.value('energy')).toBeGreaterThan(0.2);
    expect(cafe.inventory.count('coffee')).toBe(0);
    expect(cafe.economy.wallet.cash).toBe(100 - buyPrice('coffee')!);
    expect(before).toBe(1);
  });

  it('pays a fine', () => {
    const p = host({ service: 'police' });
    const r = executeOffer('police_desk', 'pay_fine', p);
    expect(r.ok).toBe(true);
    expect(p.economy.wallet.cash).toBe(1000 - SERVICE_FEES.fine);
    expect(p.economy.ledger.totalFor('fine')).toBe(-SERVICE_FEES.fine);
  });

  it('refuses a fine it cannot cover, and changes nothing', () => {
    const p = host({ service: 'police', cash: 5 });
    expect(executeOffer('police_desk', 'pay_fine', p)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    });
    expect(p.economy.wallet.cash).toBe(5);
    expect(p.economy.ledger.size).toBe(0);
  });

  it('treats at the clinic, restoring rather than depicting anything', () => {
    const c = host({ service: 'clinic' });
    c.needs.restoreFrom({ energy: 0.1, mood: 0.1 });
    const r = executeOffer('clinic_treat', 'treatment', c);
    expect(r.ok).toBe(true);
    expect(c.needs.value('energy')).toBeGreaterThan(0.1);
    expect(c.calls).toContain('treat');
    expect(c.economy.wallet.cash).toBe(1000 - SERVICE_FEES.treatment);
  });

  // -- the garage ------------------------------------------------------------

  it('buys a vehicle at the listed price', () => {
    const g = host({ service: 'garage', cash: 5000 });
    const r = executeOffer('garage_desk', 'buy_vehicle_hatchback', g);
    expect(r.ok).toBe(true);
    expect(g.calls).toContain('buy:hatchback');
    expect(g.economy.wallet.cash).toBe(5000 - vehiclePrice('hatchback')!);
  });

  it('refuses a vehicle it cannot afford', () => {
    const g = host({ service: 'garage', cash: 100 });
    expect(executeOffer('garage_desk', 'buy_vehicle_hatchback', g)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    });
    expect(g.calls).toHaveLength(0);
  });

  /**
   * The refund path. A vehicle that could not be handed over must not be a
   * vehicle that was paid for.
   */
  it('refunds when the vehicle cannot actually be delivered', () => {
    const g = host({ service: 'garage', cash: 5000, buyVehicle: () => false });
    const r = executeOffer('garage_desk', 'buy_vehicle_scooter', g);
    expect(r).toEqual({ ok: false, reason: 'refused' });
    expect(g.economy.wallet.cash).toBe(5000);
    expect(g.economy.ledger.totalFor('refund')).toBe(vehiclePrice('scooter'));
  });

  it('repairs, resprays and recovers', () => {
    const v = { id: 'v1', kind: 'van', condition: 0.3, label: 'Van' };
    const g = host({ service: 'garage', cash: 5000, selectedVehicle: v, ownedVehicles: [v] });
    expect(executeOffer('garage_desk', 'repair', g).ok).toBe(true);
    expect(executeOffer('garage_desk', 'recolour', g).ok).toBe(true);
    expect(executeOffer('garage_desk', 'recover', g).ok).toBe(true);
    expect(g.calls).toEqual(['repair:v1', 'recolour:v1', 'recover:v1']);
    expect(g.economy.wallet.cash).toBe(
      5000 - repairCost(0.3) - SERVICE_FEES.recolour - SERVICE_FEES.recovery,
    );
  });

  it('refuses to repair an undamaged vehicle', () => {
    const v = { id: 'v1', kind: 'van', condition: 1, label: 'Van' };
    const g = host({ service: 'garage', selectedVehicle: v });
    expect(executeOffer('garage_desk', 'repair', g)).toEqual({ ok: false, reason: 'not-needed' });
  });

  it('refuses to act with no vehicle selected', () => {
    const g = host({ service: 'garage' });
    expect(executeOffer('garage_desk', 'repair', g)).toEqual({ ok: false, reason: 'no-vehicle' });
    expect(executeOffer('garage_desk', 'select', g)).toEqual({ ok: false, reason: 'no-vehicle' });
  });

  it('cycles through owned vehicles', () => {
    const a = { id: 'a', kind: 'bicycle', condition: 1, label: 'Bicycle' };
    const b = { id: 'b', kind: 'van', condition: 1, label: 'Van' };
    const g = host({ service: 'garage', ownedVehicles: [a, b], selectedVehicle: a });
    expect(executeOffer('garage_desk', 'select', g).ok).toBe(true);
    expect(g.calls).toEqual(['select:b']);
  });

  // -- the apartment ---------------------------------------------------------

  it('decorates only with something already owned, and consumes it', () => {
    const apt = host({ service: 'apartment' });
    expect(executeOffer('apartment_decorate', 'decor_plant', apt)).toEqual({
      ok: false,
      reason: 'refused',
    });

    apt.inventory.add('decor_plant', 1);
    const r = executeOffer('apartment_decorate', 'decor_plant', apt);
    expect(r.ok).toBe(true);
    expect(apt.calls).toContain('decor:decor_plant');
    expect(apt.inventory.count('decor_plant')).toBe(0);
  });

  it('buys a decoration before placing it', () => {
    const apt = host({ service: 'apartment' });
    expect(executeOffer('apartment_decorate', 'buy_decor_plant', apt).ok).toBe(true);
    expect(apt.inventory.count('decor_plant')).toBe(1);
    expect(executeOffer('apartment_decorate', 'decor_plant', apt).ok).toBe(true);
  });

  it('saves from the desk', () => {
    const apt = host({ service: 'apartment' });
    expect(executeOffer('apartment_save', 'write', apt).ok).toBe(true);
    expect(apt.calls).toContain('save');
  });

  it('reports an unimplemented host hook rather than doing nothing', () => {
    const bare = host({ service: 'apartment', saveGame: undefined });
    expect(executeOffer('apartment_save', 'write', bare)).toEqual({
      ok: false,
      reason: 'unsupported',
    });
  });

  it('starts a job from the flight desk', () => {
    const a = host({ service: 'airstrip' });
    expect(executeOffer('airstrip_log', 'courier', a).ok).toBe(true);
    expect(a.calls).toContain('task:job_city_courier');
  });

  it('rejects an unknown service or offer', () => {
    expect(executeOffer('nope', 'x', h)).toEqual({ ok: false, reason: 'unknown-service' });
    expect(executeOffer('grocery_buy', 'x', h)).toEqual({ ok: false, reason: 'unknown-offer' });
  });

  it('every offer in every service is executable or explains itself', () => {
    // A smoke pass: nothing may throw, and nothing may return `unknown-offer`
    // for an offer the catalogue itself declares.
    for (const s of SERVICES) {
      for (const o of s.offers) {
        const fresh = host({ service: 'garage', cash: 20000, age: 40 });
        fresh.inventory.add('fish_small', 2);
        fresh.inventory.add('decor_plant', 1);
        fresh.inventory.add('decor_shelf', 1);
        fresh.inventory.add('decor_table', 1);
        const r = executeOffer(s.id, o.id, fresh);
        if (!r.ok) expect(r.reason, `${s.id}/${o.id}`).not.toBe('unknown-offer');
      }
    }
  });
});

describe('shop stock matches the building', () => {
  it('never sells an item through a shop that does not stock it', () => {
    // The grocery's own buy offers must all be in the grocery's stock list.
    const groceryService: ServiceType = 'grocery';
    const h2 = host({ service: groceryService, cash: 10000 });
    const menu = buildMenu('grocery_buy', h2)!;
    for (const e of menu.entries) {
      if (!e.id.startsWith('buy_')) continue;
      const r = executeOffer('grocery_buy', e.id, h2);
      expect(r.ok, `${e.id} should be stocked by the grocery`).toBe(true);
    }
  });
});
