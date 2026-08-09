import { Inventory, itemDef } from '../player/Inventory';
import type { ServiceType } from '../world/interiors/InteriorDefinition';
import { Ledger, type Transaction, type TransactionKind } from './Ledger';
import { buyPrice, buysBack, sellPrice, stocks } from './PriceCatalog';
import { Wallet, isValidAmount, type WalletData } from './Wallet';
import type { LedgerData } from './Ledger';

/**
 * The local economy.
 *
 * The one rule this file exists to enforce: **a transaction applies entirely
 * or not at all.** Buying five loaves with room for two used to be expressible
 * as "take the money, add what fits" — which is how a player pays for goods
 * that never arrive. Every operation here checks funds *and* capacity before
 * touching either.
 *
 * The second rule is that rewards are idempotent. A job that pays on
 * completion must not pay twice because the completion fired on two frames,
 * or because a save was reloaded mid-payout. Awards are keyed and the key is
 * remembered.
 *
 * Nothing here reads a clock. Timestamps are injected, exactly as the save
 * format requires, so the whole thing is deterministic under test.
 */

export type EconomyFailure =
  | 'invalid'
  | 'unknown-item'
  | 'not-stocked'
  | 'not-bought-here'
  | 'insufficient-funds'
  | 'no-room'
  | 'none-held'
  | 'already-awarded';

export type EconomyResult =
  | { readonly ok: true; readonly transaction: Transaction }
  | { readonly ok: false; readonly reason: EconomyFailure };

export interface BuyRequest {
  readonly itemId: string;
  readonly count: number;
  readonly service: ServiceType;
  readonly at: number;
  /** Skips the stock check. For a quest reward sold at a stall, not a shop. */
  readonly anyStock?: boolean;
}

export interface SellRequest {
  readonly itemId: string;
  readonly count: number;
  readonly service: ServiceType;
  readonly at: number;
}

/** Everything needed to put the economy back exactly as it was. */
export interface EconomySnapshot {
  readonly wallet: WalletData;
  readonly stacks: readonly { id: string; count: number }[];
  readonly mark: number;
  readonly awards: readonly string[];
}

export interface EconomyData {
  wallet: WalletData;
  ledger: LedgerData;
  awards: string[];
  /** In-game day the last rent charge was applied. */
  rentPaidDay: number;
}

export class Economy {
  readonly wallet: Wallet;
  readonly ledger = new Ledger();

  /** Award keys already paid. The idempotency guarantee, made concrete. */
  private awards = new Set<string>();
  private rentDay = 0;

  constructor(
    private readonly inventory: Inventory,
    cash = 0,
    bank = 0,
  ) {
    this.wallet = new Wallet(cash, bank);
  }

  // -------------------------------------------------------------------------
  // Goods
  // -------------------------------------------------------------------------

  /**
   * Buy from a shop.
   *
   * Capacity is checked against the *whole* order before any money moves.
   * `Inventory.add` reports overflow rather than throwing, which is the right
   * behaviour for a pickup and exactly the wrong one for a purchase — so the
   * check happens here, up front, and the add is only reached once it cannot
   * overflow.
   */
  buy(req: BuyRequest): EconomyResult {
    if (!Number.isSafeInteger(req.count) || req.count <= 0) {
      return { ok: false, reason: 'invalid' };
    }
    const def = itemDef(req.itemId);
    if (!def) return { ok: false, reason: 'unknown-item' };
    if (!req.anyStock && !stocks(req.service, req.itemId)) {
      return { ok: false, reason: 'not-stocked' };
    }

    const unit = buyPrice(req.itemId);
    if (unit === null) return { ok: false, reason: 'unknown-item' };

    const total = unit * req.count;
    if (!this.wallet.canAfford(total)) return { ok: false, reason: 'insufficient-funds' };
    if (!this.hasRoomFor(req.itemId, req.count)) return { ok: false, reason: 'no-room' };

    this.wallet.debit(total);
    const added = this.inventory.add(req.itemId, req.count);
    // Belt and braces. `hasRoomFor` already guaranteed this, and if the two
    // ever disagree the money must go back rather than vanish.
    if (added.overflow > 0) {
      this.inventory.remove(req.itemId, added.added);
      this.wallet.credit(total);
      return { ok: false, reason: 'no-room' };
    }

    return {
      ok: true,
      transaction: this.ledger.record({
        kind: 'purchase',
        amount: -total,
        label: `${def.name} x${req.count}`,
        at: req.at,
        items: [{ id: req.itemId, count: req.count }],
      }),
    };
  }

  sell(req: SellRequest): EconomyResult {
    if (!Number.isSafeInteger(req.count) || req.count <= 0) {
      return { ok: false, reason: 'invalid' };
    }
    const def = itemDef(req.itemId);
    if (!def) return { ok: false, reason: 'unknown-item' };
    if (!buysBack(req.service, req.itemId)) return { ok: false, reason: 'not-bought-here' };
    if (this.inventory.count(req.itemId) < req.count) return { ok: false, reason: 'none-held' };

    const unit = sellPrice(req.itemId);
    if (unit === null) return { ok: false, reason: 'unknown-item' };

    const total = unit * req.count;
    if (!this.inventory.remove(req.itemId, req.count)) return { ok: false, reason: 'none-held' };
    this.wallet.credit(total);

    return {
      ok: true,
      transaction: this.ledger.record({
        kind: 'sale',
        amount: total,
        label: `${def.name} x${req.count}`,
        at: req.at,
        items: [{ id: req.itemId, count: req.count }],
      }),
    };
  }

  /**
   * Would this whole order fit?
   *
   * Simulated against the real stack layout rather than approximated by
   * `slotLimit - usedSlots`: partial stacks absorb items without opening a
   * slot, so the cheap arithmetic refuses orders that would actually fit.
   */
  hasRoomFor(itemId: string, count: number): boolean {
    const def = itemDef(itemId);
    if (!def) return false;

    const EXEMPT = def.kind === 'key' || def.kind === 'mission' || def.kind === 'vehicleKey';
    if (EXEMPT) return true;

    let left = count;
    for (const s of this.inventory.list()) {
      if (s.id !== itemId) continue;
      left -= Math.max(0, def.maxStack - s.count);
      if (left <= 0) return true;
    }
    const freeSlots = this.inventory.slotLimit - this.inventory.usedSlots;
    return left <= freeSlots * def.maxStack;
  }

  // -------------------------------------------------------------------------
  // Money without goods
  // -------------------------------------------------------------------------

  /** A fee: fine, repair, rent, fare, treatment. */
  pay(kind: TransactionKind, amount: number, label: string, at: number): EconomyResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid' };
    if (!this.wallet.canAfford(amount)) return { ok: false, reason: 'insufficient-funds' };
    this.wallet.debit(amount);
    return {
      ok: true,
      transaction: this.ledger.record({ kind, amount: -amount, label, at }),
    };
  }

  /** Money in that is not a sale. */
  earn(kind: TransactionKind, amount: number, label: string, at: number): EconomyResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid' };
    this.wallet.credit(amount);
    return {
      ok: true,
      transaction: this.ledger.record({ kind, amount, label, at }),
    };
  }

  /**
   * Pay a job reward exactly once.
   *
   * `key` identifies the *completion*, not the job — a repeatable shift passes
   * a key with the run number in it, so doing the shift twice pays twice and
   * the same run reported twice pays once.
   */
  award(key: string, amount: number, label: string, at: number): EconomyResult {
    if (this.awards.has(key)) return { ok: false, reason: 'already-awarded' };
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid' };
    this.awards.add(key);
    this.wallet.credit(amount);
    return {
      ok: true,
      transaction: this.ledger.record({ kind: 'wage', amount, label, at }),
    };
  }

  hasAwarded(key: string): boolean {
    return this.awards.has(key);
  }

  deposit(amount: number, at: number): EconomyResult {
    const r = this.wallet.deposit(amount);
    if (!r.ok) {
      return { ok: false, reason: r.reason === 'invalid-amount' ? 'invalid' : 'insufficient-funds' };
    }
    return {
      ok: true,
      transaction: this.ledger.record({ kind: 'deposit', amount: 0, label: `Deposit ${amount}`, at }),
    };
  }

  withdraw(amount: number, at: number): EconomyResult {
    const r = this.wallet.withdraw(amount);
    if (!r.ok) {
      return { ok: false, reason: r.reason === 'invalid-amount' ? 'invalid' : 'insufficient-funds' };
    }
    return {
      ok: true,
      transaction: this.ledger.record({
        kind: 'withdrawal',
        amount: 0,
        label: `Withdraw ${amount}`,
        at,
      }),
    };
  }

  // -------------------------------------------------------------------------
  // Rent
  // -------------------------------------------------------------------------

  get lastRentDay(): number {
    return this.rentDay;
  }

  /**
   * How many rent periods are owed as of `day`.
   *
   * Counted rather than fired on a timer, so a player who was away for three
   * periods owes three — and one who reloads a save owes the same amount they
   * did before, because the answer is a function of the day, not of how many
   * times the check has run.
   */
  rentDue(day: number, periodDays: number): number {
    if (periodDays <= 0 || day <= this.rentDay) return 0;
    return Math.floor((day - this.rentDay) / periodDays);
  }

  /**
   * Charge whatever rent is owed.
   *
   * Refused wholesale when the player cannot cover it: partial rent would
   * leave a fractional period on the clock and no way to describe it. The
   * caller turns the refusal into an overdue notice.
   */
  chargeRent(day: number, periodDays: number, unitCost: number, at: number): EconomyResult {
    const periods = this.rentDue(day, periodDays);
    if (periods <= 0) return { ok: false, reason: 'invalid' };

    const total = unitCost * periods;
    if (!this.wallet.canAfford(total)) return { ok: false, reason: 'insufficient-funds' };

    this.wallet.debit(total);
    this.rentDay += periods * periodDays;
    return {
      ok: true,
      transaction: this.ledger.record({
        kind: 'rent',
        amount: -total,
        label: periods === 1 ? 'Rent' : `Rent x${periods}`,
        at,
      }),
    };
  }

  /** Start the rent clock. Called when the apartment is first taken. */
  setRentDay(day: number): void {
    this.rentDay = Math.max(0, Math.floor(day));
  }

  // -------------------------------------------------------------------------
  // Rollback
  // -------------------------------------------------------------------------

  /**
   * Everything needed to undo whatever happens next.
   *
   * Taken before a save. If the write fails, `restore` puts the money, the
   * goods and the log back — so what is on screen matches what is on disk, or
   * nothing happened at all.
   */
  snapshot(): EconomySnapshot {
    return {
      wallet: this.wallet.toJSON(),
      stacks: this.inventory.toJSON(),
      mark: this.ledger.mark(),
      awards: [...this.awards],
    };
  }

  restore(s: EconomySnapshot): void {
    this.wallet.restore(s.wallet);
    this.inventory.restore(s.stacks);
    this.ledger.rewind(s.mark);
    this.awards = new Set(s.awards);
  }

  // -------------------------------------------------------------------------
  // Persistence
  // -------------------------------------------------------------------------

  toJSON(): EconomyData {
    return {
      wallet: this.wallet.toJSON(),
      ledger: this.ledger.toJSON(),
      awards: [...this.awards],
      rentPaidDay: this.rentDay,
    };
  }

  restoreFrom(data: Partial<EconomyData>): void {
    if (data.wallet) this.wallet.restore(data.wallet);
    if (data.ledger) this.ledger.restore(data.ledger);
    this.awards = new Set(Array.isArray(data.awards) ? data.awards : []);
    this.rentDay =
      typeof data.rentPaidDay === 'number' && Number.isFinite(data.rentPaidDay)
        ? Math.max(0, Math.floor(data.rentPaidDay))
        : 0;
  }
}
