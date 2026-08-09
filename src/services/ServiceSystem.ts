import type { Economy } from '../economy/Economy';
import { SERVICE_FEES, buyPrice, repairCost, sellPrice, vehiclePrice } from '../economy/PriceCatalog';
import type { Inventory } from '../player/Inventory';
import { itemDef } from '../player/Inventory';
import type { Needs } from '../player/Needs';
import type { ServiceType } from '../world/interiors/InteriorDefinition';
import { isDecorItem, serviceDef, type OfferDef, type OfferEffect } from './ServiceCatalog';

/**
 * Turning an offer into a thing that happened.
 *
 * Everything that costs money goes through `Economy`, which is what makes the
 * atomicity guarantee hold at this level too: `ServiceSystem` never debits and
 * then tries, it asks `Economy` to do both or neither.
 *
 * The host supplies the parts that are not economic — sleeping, saving,
 * repainting a car. Those are optional so that a unit test can exercise the
 * whole menu without a renderer, and an unimplemented one is reported as
 * unavailable rather than silently doing nothing.
 */

export interface ServiceHost {
  readonly economy: Economy;
  readonly inventory: Inventory;
  readonly needs: Needs;
  readonly age: number;
  /** Milliseconds, injected. Never Date.now() in here. */
  readonly now: number;
  readonly service: ServiceType;
  /** Whether the building is currently open. Closed hides nothing, disables all. */
  readonly open: boolean;

  /** The vehicle the garage would act on, if any. */
  selectedVehicle?: { id: string; kind: string; condition: number; label: string } | null;
  ownedVehicles?: readonly { id: string; kind: string; condition: number; label: string }[];

  buyVehicle?(kind: string): boolean;
  repairVehicle?(id: string): boolean;
  recolourVehicle?(id: string): boolean;
  recoverVehicle?(id: string): boolean;
  selectVehicle?(id: string): boolean;
  sleep?(): void;
  shower?(): void;
  saveGame?(): void;
  placeDecor?(itemId: string): boolean;
  talk?(topic: string): void;
  startTask?(taskId: string): boolean;
  /** Clinic. Restores needs and clears whatever "injured" comes to mean. */
  treat?(): void;
}

export interface MenuEntry {
  readonly id: string;
  readonly label: string;
  readonly price: number;
  readonly detail?: string;
  readonly available: boolean;
  /** Why not, when `available` is false. Shown next to the greyed entry. */
  readonly reason?: string;
}

export interface ServiceMenu {
  readonly id: string;
  readonly title: string;
  readonly entries: readonly MenuEntry[];
  readonly open: boolean;
}

export type ServiceFailure =
  | 'unknown-service'
  | 'unknown-offer'
  | 'closed'
  | 'too-young'
  | 'unsupported'
  | 'no-vehicle'
  | 'nothing-to-sell'
  | 'not-needed'
  | 'insufficient-funds'
  | 'no-room'
  | 'refused';

export type ServiceResult =
  | { readonly ok: true; readonly spent: number; readonly gained: number; readonly label: string }
  | { readonly ok: false; readonly reason: ServiceFailure };

/** What an offer costs right now. Vehicles and repairs are state-dependent. */
export function priceOfOffer(effect: OfferEffect, host: ServiceHost): number {
  switch (effect.kind) {
    case 'buy':
      return (buyPrice(effect.itemId) ?? 0) * effect.count;
    case 'consumeHere':
      return buyPrice(effect.itemId) ?? 0;
    case 'sellAll':
      return 0;
    case 'fee':
      return SERVICE_FEES[effect.fee];
    case 'treat':
      return SERVICE_FEES.treatment;
    case 'vehicleBuy':
      return vehiclePrice(effect.vehicleKind) ?? 0;
    case 'vehicleRepair':
      return host.selectedVehicle ? repairCost(host.selectedVehicle.condition) : 0;
    case 'vehicleRecolour':
      return SERVICE_FEES.recolour;
    case 'vehicleRecover':
      return SERVICE_FEES.recovery;
    case 'decorate':
      return 0; // you must already own the thing
    default:
      return 0;
  }
}

function availability(offer: OfferDef, host: ServiceHost): { ok: boolean; reason?: string } {
  if (!host.open) return { ok: false, reason: 'Closed' };
  if (offer.minAge !== undefined && host.age < offer.minAge) {
    return { ok: false, reason: `Ages ${offer.minAge} and over` };
  }

  const e = offer.effect;
  switch (e.kind) {
    case 'buy': {
      const price = priceOfOffer(e, host);
      if (!host.economy.wallet.canAfford(price)) return { ok: false, reason: 'Not enough cash' };
      if (!host.economy.hasRoomFor(e.itemId, e.count)) return { ok: false, reason: 'Bag is full' };
      return { ok: true };
    }
    case 'consumeHere': {
      if (!host.economy.wallet.canAfford(priceOfOffer(e, host))) {
        return { ok: false, reason: 'Not enough cash' };
      }
      return { ok: true };
    }
    case 'sellAll':
      return host.inventory.count(e.itemId) > 0
        ? { ok: true }
        : { ok: false, reason: 'Nothing to sell' };
    case 'fee':
    case 'treat':
    case 'vehicleBuy':
    case 'vehicleRecolour':
    case 'vehicleRecover':
      return host.economy.wallet.canAfford(priceOfOffer(e, host))
        ? { ok: true }
        : { ok: false, reason: 'Not enough cash' };
    case 'vehicleRepair': {
      if (!host.selectedVehicle) return { ok: false, reason: 'No vehicle here' };
      if (host.selectedVehicle.condition >= 1) return { ok: false, reason: 'Nothing to fix' };
      return host.economy.wallet.canAfford(priceOfOffer(e, host))
        ? { ok: true }
        : { ok: false, reason: 'Not enough cash' };
    }
    case 'vehicleSelect':
      return (host.ownedVehicles?.length ?? 0) > 0
        ? { ok: true }
        : { ok: false, reason: 'You own nothing yet' };
    case 'decorate':
      return host.inventory.count(e.itemId) > 0
        ? { ok: true }
        : { ok: false, reason: 'Buy one first' };
    default:
      return { ok: true };
  }
}

/**
 * The menu as the player sees it.
 *
 * Every offer is listed, including the ones that cannot run — a shop whose
 * unaffordable items simply vanish is a shop that looks empty when you are
 * broke, which reads as a bug rather than as a budget.
 */
export function buildMenu(serviceId: string, host: ServiceHost): ServiceMenu | null {
  const def = serviceDef(serviceId);
  if (!def) return null;
  return {
    id: def.id,
    title: def.title,
    open: host.open,
    entries: def.offers.map((offer) => {
      const a = availability(offer, host);
      return {
        id: offer.id,
        label: offer.label,
        price: priceOfOffer(offer.effect, host),
        detail: offer.detail,
        available: a.ok,
        reason: a.reason,
      };
    }),
  };
}

export function executeOffer(
  serviceId: string,
  offerId: string,
  host: ServiceHost,
): ServiceResult {
  const def = serviceDef(serviceId);
  if (!def) return { ok: false, reason: 'unknown-service' };
  const offer = def.offers.find((o) => o.id === offerId);
  if (!offer) return { ok: false, reason: 'unknown-offer' };

  if (!host.open) return { ok: false, reason: 'closed' };
  if (offer.minAge !== undefined && host.age < offer.minAge) {
    return { ok: false, reason: 'too-young' };
  }

  const e = offer.effect;
  const price = priceOfOffer(e, host);

  switch (e.kind) {
    case 'buy': {
      const r = host.economy.buy({
        itemId: e.itemId,
        count: e.count,
        service: host.service,
        at: host.now,
      });
      if (!r.ok) {
        return { ok: false, reason: r.reason === 'no-room' ? 'no-room' : 'insufficient-funds' };
      }
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'sellAll': {
      const count = host.inventory.count(e.itemId);
      if (count <= 0) return { ok: false, reason: 'nothing-to-sell' };
      const r = host.economy.sell({
        itemId: e.itemId,
        count,
        service: host.service,
        at: host.now,
      });
      if (!r.ok) return { ok: false, reason: 'refused' };
      return { ok: true, spent: 0, gained: (sellPrice(e.itemId) ?? 0) * count, label: offer.label };
    }

    /**
     * Eating at the counter.
     *
     * Charged and consumed in one step, without ever entering the bag — which
     * is the point: a full bag must not stop you buying a coffee to drink
     * standing there.
     */
    case 'consumeHere': {
      const def2 = itemDef(e.itemId);
      if (!def2) return { ok: false, reason: 'unknown-offer' };
      const r = host.economy.pay('purchase', price, offer.label, host.now);
      if (!r.ok) return { ok: false, reason: 'insufficient-funds' };
      if (def2.restores) host.needs.restoreMany(def2.restores);
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'fee': {
      const kind = e.fee === 'fine' ? 'fine' : e.fee === 'rent' ? 'rent' : 'repair';
      const r = host.economy.pay(kind, price, offer.label, host.now);
      if (!r.ok) return { ok: false, reason: 'insufficient-funds' };
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'treat': {
      const r = host.economy.pay('repair', price, 'Treatment', host.now);
      if (!r.ok) return { ok: false, reason: 'insufficient-funds' };
      // Non-graphic by construction: this restores needs, it does not model
      // an injury. Phase 9 owns whatever "hurt" becomes.
      host.needs.restore('energy', 0.6);
      host.needs.restore('mood', 0.3);
      host.treat?.();
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'vehicleBuy': {
      if (!host.buyVehicle) return { ok: false, reason: 'unsupported' };
      if (price <= 0) return { ok: false, reason: 'refused' };
      const paid = host.economy.pay('purchase', price, offer.label, host.now);
      if (!paid.ok) return { ok: false, reason: 'insufficient-funds' };
      if (!host.buyVehicle(e.vehicleKind)) {
        // Give the money back. A vehicle that could not be handed over must
        // not be a vehicle that was paid for.
        host.economy.earn('refund', price, `Refund: ${offer.label}`, host.now);
        return { ok: false, reason: 'refused' };
      }
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'vehicleRepair': {
      const v = host.selectedVehicle;
      if (!v) return { ok: false, reason: 'no-vehicle' };
      if (v.condition >= 1) return { ok: false, reason: 'not-needed' };
      if (!host.repairVehicle) return { ok: false, reason: 'unsupported' };
      const paid = host.economy.pay('repair', price, `Repair ${v.label}`, host.now);
      if (!paid.ok) return { ok: false, reason: 'insufficient-funds' };
      if (!host.repairVehicle(v.id)) {
        host.economy.earn('refund', price, 'Refund: repair', host.now);
        return { ok: false, reason: 'refused' };
      }
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'vehicleRecolour': {
      const v = host.selectedVehicle;
      if (!v) return { ok: false, reason: 'no-vehicle' };
      if (!host.recolourVehicle) return { ok: false, reason: 'unsupported' };
      const paid = host.economy.pay('repair', price, `Respray ${v.label}`, host.now);
      if (!paid.ok) return { ok: false, reason: 'insufficient-funds' };
      if (!host.recolourVehicle(v.id)) {
        host.economy.earn('refund', price, 'Refund: respray', host.now);
        return { ok: false, reason: 'refused' };
      }
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'vehicleRecover': {
      const v = host.selectedVehicle ?? host.ownedVehicles?.[0] ?? null;
      if (!v) return { ok: false, reason: 'no-vehicle' };
      if (!host.recoverVehicle) return { ok: false, reason: 'unsupported' };
      const paid = host.economy.pay('repair', price, `Recover ${v.label}`, host.now);
      if (!paid.ok) return { ok: false, reason: 'insufficient-funds' };
      if (!host.recoverVehicle(v.id)) {
        host.economy.earn('refund', price, 'Refund: recovery', host.now);
        return { ok: false, reason: 'refused' };
      }
      return { ok: true, spent: price, gained: 0, label: offer.label };
    }

    case 'vehicleSelect': {
      const owned = host.ownedVehicles ?? [];
      if (owned.length === 0) return { ok: false, reason: 'no-vehicle' };
      if (!host.selectVehicle) return { ok: false, reason: 'unsupported' };
      // Cycle to the next one, so pressing it repeatedly walks the list.
      const current = host.selectedVehicle?.id;
      const at = owned.findIndex((v) => v.id === current);
      const next = owned[(at + 1) % owned.length];
      if (!host.selectVehicle(next.id)) return { ok: false, reason: 'refused' };
      return { ok: true, spent: 0, gained: 0, label: next.label };
    }

    case 'decorate': {
      if (!isDecorItem(e.itemId)) return { ok: false, reason: 'unknown-offer' };
      if (host.inventory.count(e.itemId) <= 0) return { ok: false, reason: 'refused' };
      if (!host.placeDecor) return { ok: false, reason: 'unsupported' };
      if (!host.placeDecor(e.itemId)) return { ok: false, reason: 'refused' };
      host.inventory.remove(e.itemId, 1);
      return { ok: true, spent: 0, gained: 0, label: offer.label };
    }

    case 'sleep':
      if (!host.sleep) return { ok: false, reason: 'unsupported' };
      host.sleep();
      return { ok: true, spent: 0, gained: 0, label: offer.label };

    case 'shower':
      if (!host.shower) return { ok: false, reason: 'unsupported' };
      host.shower();
      return { ok: true, spent: 0, gained: 0, label: offer.label };

    case 'save':
      if (!host.saveGame) return { ok: false, reason: 'unsupported' };
      host.saveGame();
      return { ok: true, spent: 0, gained: 0, label: offer.label };

    case 'talk':
      host.talk?.(e.topic);
      return { ok: true, spent: 0, gained: 0, label: offer.label };

    case 'startTask':
      if (!host.startTask) return { ok: false, reason: 'unsupported' };
      if (!host.startTask(e.taskId)) return { ok: false, reason: 'refused' };
      return { ok: true, spent: 0, gained: 0, label: offer.label };
  }
}
