import { beforeEach, describe, expect, it } from 'vitest';
import { Inventory } from '../src/player/Inventory';
import { Economy } from '../src/economy/Economy';
import { Ledger } from '../src/economy/Ledger';
import { Wallet, isValidAmount } from '../src/economy/Wallet';
import {
  ITEM_PRICES,
  JOB_PAY,
  RENT_PERIOD_DAYS,
  REPAIR_CALLOUT,
  SERVICE_FEES,
  SHOP_BUYS,
  SHOP_STOCK,
  buyPrice,
  repairCost,
  sellPrice,
  vehiclePrice,
} from '../src/economy/PriceCatalog';

const AT = 1_700_000_000_000;

describe('wallet', () => {
  it('rejects anything that is not a whole non-negative amount', () => {
    for (const bad of [1.5, -1, NaN, Infinity, -0.0001]) expect(isValidAmount(bad)).toBe(false);
    for (const good of [0, 1, 4200]) expect(isValidAmount(good)).toBe(true);
  });

  it('refuses a debit it cannot cover, and changes nothing', () => {
    const w = new Wallet(10);
    expect(w.debit(11)).toEqual({ ok: false, reason: 'insufficient-cash' });
    expect(w.cash).toBe(10);
  });

  it('never spends the bank to cover a cash purchase', () => {
    const w = new Wallet(5, 1000);
    expect(w.debit(20).ok).toBe(false);
    expect(w.cash).toBe(5);
    expect(w.bank).toBe(1000);
  });

  it('moves money between pockets without creating any', () => {
    const w = new Wallet(100, 0);
    w.deposit(60);
    expect(w.cash).toBe(40);
    expect(w.bank).toBe(60);
    expect(w.total).toBe(100);
    w.withdraw(60);
    expect(w.total).toBe(100);
    expect(w.cash).toBe(100);
  });

  it('refuses a withdrawal larger than the balance', () => {
    const w = new Wallet(0, 10);
    expect(w.withdraw(11)).toEqual({ ok: false, reason: 'insufficient-bank' });
    expect(w.bank).toBe(10);
  });

  it('sanitises a corrupt save rather than trusting it', () => {
    const w = new Wallet();
    w.restore({ cash: NaN, bank: -5 });
    expect(w.cash).toBe(0);
    expect(w.bank).toBe(0);
  });
});

describe('price catalogue', () => {
  it('never sells back for more than it charges', () => {
    // One inverted pair is an infinite money loop.
    for (const p of ITEM_PRICES) {
      expect(p.sell, `${p.id}`).toBeLessThan(p.buy);
      expect(p.sell).toBeGreaterThanOrEqual(0);
    }
  });

  it('prices everything in whole dollars', () => {
    for (const p of ITEM_PRICES) {
      expect(Number.isSafeInteger(p.buy), `${p.id} buy`).toBe(true);
      expect(Number.isSafeInteger(p.sell), `${p.id} sell`).toBe(true);
    }
    for (const v of Object.values(JOB_PAY)) expect(Number.isSafeInteger(v)).toBe(true);
    for (const v of Object.values(SERVICE_FEES)) expect(Number.isSafeInteger(v)).toBe(true);
  });

  it('has no duplicate entries', () => {
    const ids = ITEM_PRICES.map((p) => p.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('prices every item any shop stocks or buys', () => {
    for (const list of [...Object.values(SHOP_STOCK), ...Object.values(SHOP_BUYS)]) {
      for (const id of list ?? []) expect(buyPrice(id), id).not.toBeNull();
    }
  });

  it('does not sell the patrol car', () => {
    expect(vehiclePrice('police')).toBeNull();
    expect(vehiclePrice('hatchback')).toBe(4200);
  });

  it('charges nothing to repair an undamaged vehicle', () => {
    expect(repairCost(1)).toBe(0);
    expect(repairCost(1.4)).toBe(0);
  });

  it('charges a call-out fee even for a scratch', () => {
    expect(repairCost(0.999)).toBeGreaterThanOrEqual(REPAIR_CALLOUT);
  });

  it('scales repair with damage and rounds to whole dollars', () => {
    const half = repairCost(0.5);
    const wrecked = repairCost(0);
    expect(Number.isSafeInteger(half)).toBe(true);
    expect(wrecked).toBeGreaterThan(half);
    expect(repairCost(-3)).toBe(wrecked); // clamped, not extrapolated
  });
});

describe('economy transactions', () => {
  let inv: Inventory;
  let eco: Economy;

  beforeEach(() => {
    inv = new Inventory(16);
    eco = new Economy(inv, 100);
  });

  it('buys goods and takes exactly the listed price', () => {
    const r = eco.buy({ itemId: 'bread', count: 2, service: 'grocery', at: AT });
    expect(r.ok).toBe(true);
    expect(eco.wallet.cash).toBe(100 - 2 * buyPrice('bread')!);
    expect(inv.count('bread')).toBe(2);
  });

  it('refuses a purchase it cannot afford, and moves nothing', () => {
    const poor = new Economy(new Inventory(16), 2);
    const r = poor.buy({ itemId: 'meal', count: 1, service: 'grocery', at: AT });
    expect(r).toEqual({ ok: false, reason: 'insufficient-funds' });
    expect(poor.wallet.cash).toBe(2);
    expect(poor.ledger.size).toBe(0);
  });

  it('will not sell you something the shop does not stock', () => {
    const r = eco.buy({ itemId: 'shirt_sky', count: 1, service: 'grocery', at: AT });
    expect(r).toEqual({ ok: false, reason: 'not-stocked' });
    expect(eco.wallet.cash).toBe(100);
  });

  it('rejects an unknown item', () => {
    const r = eco.buy({ itemId: 'moon_rock', count: 1, service: 'grocery', at: AT });
    expect(r).toEqual({ ok: false, reason: 'unknown-item' });
  });

  it('rejects a nonsense count', () => {
    for (const count of [0, -1, 1.5, NaN]) {
      expect(eco.buy({ itemId: 'bread', count, service: 'grocery', at: AT }).ok).toBe(false);
    }
  });

  it('takes no money when the bag is full', () => {
    // Fill every slot with distinct non-exempt items.
    const filler = ['bread', 'apple', 'coffee', 'tea', 'meal', 'soap', 'grocery_bag'];
    const small = new Inventory(2);
    const e = new Economy(small, 1000);
    small.add('shirt_cream', 1);
    small.add('trousers_navy', 1);
    expect(small.isFull).toBe(true);

    const before = e.wallet.cash;
    const r = e.buy({ itemId: 'hat_red', count: 1, service: 'clothing', at: AT });
    expect(r).toEqual({ ok: false, reason: 'no-room' });
    expect(e.wallet.cash).toBe(before);
    expect(filler.length).toBeGreaterThan(0);
  });

  it('counts room in partial stacks, not just free slots', () => {
    const small = new Inventory(1);
    const e = new Economy(small, 1000);
    small.add('apple', 5); // maxStack 8, so three more fit in the open stack
    expect(small.isFull).toBe(true);
    expect(e.hasRoomFor('apple', 3)).toBe(true);
    expect(e.hasRoomFor('apple', 4)).toBe(false);
    expect(e.buy({ itemId: 'apple', count: 3, service: 'grocery', at: AT }).ok).toBe(true);
    expect(small.count('apple')).toBe(8);
  });

  it('sells goods back and credits the sell price', () => {
    inv.add('fish_large', 2);
    const r = eco.sell({ itemId: 'fish_large', count: 2, service: 'grocery', at: AT });
    expect(r.ok).toBe(true);
    expect(eco.wallet.cash).toBe(100 + 2 * sellPrice('fish_large')!);
    expect(inv.count('fish_large')).toBe(0);
  });

  it('refuses to sell what is not held, and what the shop will not take', () => {
    expect(eco.sell({ itemId: 'fish_large', count: 1, service: 'grocery', at: AT })).toEqual({
      ok: false,
      reason: 'none-held',
    });
    inv.add('bread', 1);
    expect(eco.sell({ itemId: 'bread', count: 1, service: 'clothing', at: AT })).toEqual({
      ok: false,
      reason: 'not-bought-here',
    });
    expect(inv.count('bread')).toBe(1);
  });

  it('cannot be farmed by buying and reselling', () => {
    const e = new Economy(new Inventory(16), 1000);
    const start = e.wallet.cash;
    for (let i = 0; i < 20; i++) {
      e.buy({ itemId: 'apple', count: 1, service: 'grocery', at: AT });
      e.sell({ itemId: 'apple', count: 1, service: 'grocery', at: AT });
    }
    expect(e.wallet.cash).toBeLessThan(start);
  });

  it('records a signed ledger entry per transaction', () => {
    eco.buy({ itemId: 'bread', count: 1, service: 'grocery', at: AT });
    eco.earn('wage', 45, 'Shift', AT);
    const entries = eco.ledger.list();
    expect(entries).toHaveLength(2);
    expect(entries[0].amount).toBeLessThan(0);
    expect(entries[1].amount).toBe(45);
    expect(eco.ledger.net()).toBe(45 - buyPrice('bread')!);
  });

  it('refuses a fee it cannot cover', () => {
    const e = new Economy(new Inventory(16), 10);
    expect(e.pay('fine', SERVICE_FEES.fine, 'Fine', AT)).toEqual({
      ok: false,
      reason: 'insufficient-funds',
    });
    expect(e.wallet.cash).toBe(10);
    expect(e.ledger.size).toBe(0);
  });
});

describe('reward idempotency', () => {
  it('pays an award once, however many times it is reported', () => {
    const eco = new Economy(new Inventory(16), 0);
    const first = eco.award('job_grocery_shift#1', 45, 'Shift', AT);
    expect(first.ok).toBe(true);
    expect(eco.wallet.cash).toBe(45);

    for (let i = 0; i < 5; i++) {
      expect(eco.award('job_grocery_shift#1', 45, 'Shift', AT)).toEqual({
        ok: false,
        reason: 'already-awarded',
      });
    }
    expect(eco.wallet.cash).toBe(45);
    expect(eco.ledger.size).toBe(1);
  });

  it('pays a second run of the same job', () => {
    const eco = new Economy(new Inventory(16), 0);
    eco.award('job_grocery_shift#1', 45, 'Shift', AT);
    eco.award('job_grocery_shift#2', 45, 'Shift', AT);
    expect(eco.wallet.cash).toBe(90);
  });

  it('survives a save round trip without re-paying', () => {
    const eco = new Economy(new Inventory(16), 0);
    eco.award('job_taxi_driving#7', 30, 'Fare', AT);

    const restored = new Economy(new Inventory(16), 0);
    restored.restoreFrom(eco.toJSON());
    expect(restored.hasAwarded('job_taxi_driving#7')).toBe(true);
    expect(restored.award('job_taxi_driving#7', 30, 'Fare', AT).ok).toBe(false);
    expect(restored.wallet.cash).toBe(30);
  });
});

describe('rent', () => {
  it('owes nothing before a period has passed', () => {
    const eco = new Economy(new Inventory(16), 1000);
    eco.setRentDay(1);
    expect(eco.rentDue(1, RENT_PERIOD_DAYS)).toBe(0);
    expect(eco.rentDue(7, RENT_PERIOD_DAYS)).toBe(0);
  });

  it('owes one period on the day it falls due', () => {
    const eco = new Economy(new Inventory(16), 1000);
    eco.setRentDay(1);
    expect(eco.rentDue(8, RENT_PERIOD_DAYS)).toBe(1);
  });

  it('owes every period the player was away for', () => {
    const eco = new Economy(new Inventory(16), 1000);
    eco.setRentDay(0);
    expect(eco.rentDue(21, RENT_PERIOD_DAYS)).toBe(3);
    const r = eco.chargeRent(21, RENT_PERIOD_DAYS, SERVICE_FEES.rent, AT);
    expect(r.ok).toBe(true);
    expect(eco.wallet.cash).toBe(1000 - 3 * SERVICE_FEES.rent);
    expect(eco.rentDue(21, RENT_PERIOD_DAYS)).toBe(0);
  });

  it('does not charge twice for the same period', () => {
    const eco = new Economy(new Inventory(16), 1000);
    eco.setRentDay(0);
    eco.chargeRent(7, RENT_PERIOD_DAYS, SERVICE_FEES.rent, AT);
    const after = eco.wallet.cash;
    eco.chargeRent(7, RENT_PERIOD_DAYS, SERVICE_FEES.rent, AT);
    expect(eco.wallet.cash).toBe(after);
  });

  it('refuses partial rent rather than leaving half a period owing', () => {
    const eco = new Economy(new Inventory(16), 100);
    eco.setRentDay(0);
    const r = eco.chargeRent(14, RENT_PERIOD_DAYS, SERVICE_FEES.rent, AT);
    expect(r).toEqual({ ok: false, reason: 'insufficient-funds' });
    expect(eco.wallet.cash).toBe(100);
    expect(eco.rentDue(14, RENT_PERIOD_DAYS)).toBe(2); // still owed
  });

  it('is a function of the day, so a reload owes the same', () => {
    const eco = new Economy(new Inventory(16), 1000);
    eco.setRentDay(0);
    const copy = new Economy(new Inventory(16), 1000);
    copy.restoreFrom(eco.toJSON());
    expect(copy.rentDue(14, RENT_PERIOD_DAYS)).toBe(eco.rentDue(14, RENT_PERIOD_DAYS));
  });
});

describe('rollback on a failed save', () => {
  it('puts money, goods and the log back exactly', () => {
    const inv = new Inventory(16);
    const eco = new Economy(inv, 500);
    inv.add('apple', 2);

    const before = eco.snapshot();
    const cashBefore = eco.wallet.cash;
    const logBefore = eco.ledger.size;

    eco.buy({ itemId: 'meal', count: 2, service: 'grocery', at: AT });
    eco.sell({ itemId: 'apple', count: 2, service: 'grocery', at: AT });
    eco.award('job#1', 45, 'Shift', AT);
    expect(eco.wallet.cash).not.toBe(cashBefore);

    eco.restore(before);

    expect(eco.wallet.cash).toBe(cashBefore);
    expect(eco.ledger.size).toBe(logBefore);
    expect(inv.count('apple')).toBe(2);
    expect(inv.count('meal')).toBe(0);
    // Critically, the award key is released too — otherwise the rolled-back
    // job could never be paid.
    expect(eco.hasAwarded('job#1')).toBe(false);
  });

  it('rewinds the ledger by sequence, not by length', () => {
    const led = new Ledger();
    const mark = led.mark();
    for (let i = 0; i < 5; i++) led.record({ kind: 'sale', amount: 1, label: 'x', at: AT });
    led.rewind(mark);
    expect(led.size).toBe(0);
    // The next entry reuses the sequence, so a rewind leaves no gap.
    expect(led.record({ kind: 'sale', amount: 1, label: 'y', at: AT }).seq).toBe(mark);
  });

  it('keeps the log bounded', () => {
    const led = new Ledger();
    for (let i = 0; i < 500; i++) led.record({ kind: 'sale', amount: 1, label: 'x', at: AT });
    expect(led.size).toBe(200);
    // Trimming the front must not corrupt the mark.
    expect(led.mark()).toBe(501);
  });

  it('never mints a duplicate sequence after restoring a corrupt counter', () => {
    const led = new Ledger();
    led.restore({ seq: 1, entries: [{ seq: 9, kind: 'sale', amount: 1, label: 'x', at: AT }] });
    expect(led.record({ kind: 'sale', amount: 1, label: 'y', at: AT }).seq).toBe(10);
  });
});
