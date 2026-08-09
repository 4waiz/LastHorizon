/**
 * Every movement of money, in order.
 *
 * Two jobs, and the second is the reason it exists at all:
 *
 * 1. It is what the player sees when they ask where the money went.
 * 2. It is the **undo log**. A save that fails after a purchase has already
 *    been applied would otherwise leave the run in a state that is on screen
 *    but not on disk — and reloading would silently give the money back while
 *    keeping the goods. The ledger's length is a checkpoint, and `Economy`
 *    rewinds to it.
 *
 * Bounded: the log keeps the most recent `MAX_ENTRIES` and drops the rest.
 * An unbounded log in a game with no session limit is a memory leak with good
 * intentions.
 */

export type TransactionKind =
  | 'purchase'
  | 'sale'
  | 'wage'
  | 'fine'
  | 'repair'
  | 'rent'
  | 'fare'
  | 'deposit'
  | 'withdrawal'
  | 'refund';

export interface TransactionItem {
  readonly id: string;
  readonly count: number;
}

export interface Transaction {
  /** Monotonic within a run. Not persisted as an identity, only for order. */
  readonly seq: number;
  readonly kind: TransactionKind;
  /**
   * Signed, from the player's point of view: positive is money arriving.
   * A purchase is negative, a wage positive, a deposit zero — it moves between
   * two pockets the player already owns.
   */
  readonly amount: number;
  readonly label: string;
  /** Milliseconds since epoch, injected by the caller. Never Date.now(). */
  readonly at: number;
  readonly items?: readonly TransactionItem[];
}

export const MAX_ENTRIES = 200;

export interface LedgerData {
  seq: number;
  entries: Transaction[];
}

export class Ledger {
  private entries: Transaction[] = [];
  private nextSeq = 1;

  get size(): number {
    return this.entries.length;
  }

  /** Newest last. */
  list(): readonly Transaction[] {
    return this.entries;
  }

  recent(n: number): readonly Transaction[] {
    return this.entries.slice(Math.max(0, this.entries.length - n));
  }

  record(entry: Omit<Transaction, 'seq'>): Transaction {
    const t: Transaction = { ...entry, seq: this.nextSeq++ };
    this.entries.push(t);
    if (this.entries.length > MAX_ENTRIES) {
      this.entries.splice(0, this.entries.length - MAX_ENTRIES);
    }
    return t;
  }

  /**
   * A point to come back to.
   *
   * The sequence number, not the array length — the log is trimmed at the
   * front, so a length taken before a trim rewinds to the wrong place.
   */
  mark(): number {
    return this.nextSeq;
  }

  /** Discard everything recorded at or after `mark`. */
  rewind(mark: number): void {
    this.entries = this.entries.filter((e) => e.seq < mark);
    this.nextSeq = mark;
  }

  /** Net change across the whole log. Used by the balance-sheet checks. */
  net(): number {
    return this.entries.reduce((sum, e) => sum + e.amount, 0);
  }

  totalFor(kind: TransactionKind): number {
    return this.entries.filter((e) => e.kind === kind).reduce((s, e) => s + e.amount, 0);
  }

  clear(): void {
    this.entries = [];
    this.nextSeq = 1;
  }

  toJSON(): LedgerData {
    return { seq: this.nextSeq, entries: this.entries.map((e) => ({ ...e })) };
  }

  restore(data: Partial<LedgerData>): void {
    this.entries = Array.isArray(data.entries)
      ? data.entries.filter((e) => typeof e?.seq === 'number' && Number.isFinite(e.amount))
      : [];
    const highest = this.entries.reduce((m, e) => Math.max(m, e.seq), 0);
    // Trust the saved counter only if it is ahead of every entry it claims to
    // have issued; a corrupt one that is behind would mint duplicate seqs.
    this.nextSeq = Math.max(typeof data.seq === 'number' ? data.seq : 1, highest + 1);
  }
}
