/**
 * Cash in a pocket, and money in a bank.
 *
 * **Whole units only.** Every price in the game is an integer number of
 * dollars, and nothing here accepts a fraction. That is a design decision, not
 * a simplification: prices the player can add up in their head are the ones
 * that stay "understandable and fun", and integer arithmetic cannot drift the
 * way repeated float addition of 0.10 does. A balance that reads 19.999999
 * after twenty transactions is a bug report.
 *
 * The bank is optional in the sense that a player can ignore it entirely —
 * everything can be paid in cash. What it buys is somewhere to put money that
 * a fine cannot reach on the spot, which is the only mechanical difference.
 *
 * Pure. No persistence, no clock, no events.
 */

export interface WalletData {
  cash: number;
  bank: number;
}

/** What went wrong, in a form a caller can turn into a message. */
export type WalletFailure = 'invalid-amount' | 'insufficient-cash' | 'insufficient-bank';

export type WalletResult = { ok: true } | { ok: false; reason: WalletFailure };

const OK: WalletResult = { ok: true };

/** Integers, finite, non-negative. Rejects NaN, Infinity and 1.5 alike. */
export function isValidAmount(v: number): boolean {
  return Number.isSafeInteger(v) && v >= 0;
}

export class Wallet {
  private cashValue = 0;
  private bankValue = 0;

  constructor(cash = 0, bank = 0) {
    this.cashValue = isValidAmount(cash) ? cash : 0;
    this.bankValue = isValidAmount(bank) ? bank : 0;
  }

  get cash(): number {
    return this.cashValue;
  }

  get bank(): number {
    return this.bankValue;
  }

  /** Everything the player owns. What the HUD shows. */
  get total(): number {
    return this.cashValue + this.bankValue;
  }

  canAfford(amount: number): boolean {
    return isValidAmount(amount) && this.cashValue >= amount;
  }

  /** Money in. Wages, sales, refunds. */
  credit(amount: number): WalletResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid-amount' };
    this.cashValue += amount;
    return OK;
  }

  /**
   * Money out, cash only.
   *
   * Deliberately does *not* fall back to the bank. A purchase that quietly
   * drains savings the player was holding back is worse than one that is
   * refused, and the refusal is what the shop UI is there to explain.
   */
  debit(amount: number): WalletResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid-amount' };
    if (this.cashValue < amount) return { ok: false, reason: 'insufficient-cash' };
    this.cashValue -= amount;
    return OK;
  }

  deposit(amount: number): WalletResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid-amount' };
    if (this.cashValue < amount) return { ok: false, reason: 'insufficient-cash' };
    this.cashValue -= amount;
    this.bankValue += amount;
    return OK;
  }

  withdraw(amount: number): WalletResult {
    if (!isValidAmount(amount)) return { ok: false, reason: 'invalid-amount' };
    if (this.bankValue < amount) return { ok: false, reason: 'insufficient-bank' };
    this.bankValue -= amount;
    this.cashValue += amount;
    return OK;
  }

  toJSON(): WalletData {
    return { cash: this.cashValue, bank: this.bankValue };
  }

  restore(data: Partial<WalletData>): void {
    this.cashValue = isValidAmount(data.cash ?? 0) ? (data.cash ?? 0) : 0;
    this.bankValue = isValidAmount(data.bank ?? 0) ? (data.bank ?? 0) : 0;
  }
}
