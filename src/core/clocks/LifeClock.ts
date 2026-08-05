/**
 * Age, and the birthdays that gate the whole game.
 *
 * One active real-world hour is one in-game year. "Active" is the load-bearing
 * word: a clock that ran on wall time would age the character while the tab sat
 * in the background, and a player who left the game open overnight would come
 * back to a stranger. So this clock is fed elapsed seconds by the frame loop
 * and refuses them whenever anything blocks play.
 *
 * Deliberately independent of `WorldClock` and `StoryClock`. Deriving age from
 * the day/night scalar would tie a cosmetic setting — "lock the time to dusk" —
 * to the player's lifespan.
 *
 * Pure: no DOM, no Three.js, no timers. The frame loop decides when time has
 * passed; this only decides what that means.
 */

/** Real minutes per in-game year. `frozen` stops ageing entirely. */
export type LifeRate = 30 | 60 | 120 | 'frozen';

export const DEFAULT_LIFE_RATE: LifeRate = 60;

/** Authored range the framework supports. The MVP story covers 15–25. */
export const MIN_AGE = 15;
export const MAX_AGE = 80;

/**
 * Why life is not advancing right now.
 *
 * Modelled as a set rather than a boolean because several can hold at once —
 * a hidden tab during a save migration, say — and each must release
 * independently or the clock stays stuck.
 */
export type LifeBlockReason =
  | 'hidden'
  | 'paused'
  | 'loading'
  | 'settings'
  | 'saveMigration'
  | 'photoMode'
  | 'birthday';

export interface LifeClockSnapshot {
  ageYears: number;
  /** 0..1 through the current year. */
  yearProgress: number;
  /** Highest birthday the game has finished handling. */
  lastHandledAge: number;
  rate: LifeRate;
  /** Total active seconds lived, for summaries. */
  activeSeconds: number;
}

export interface LifeTick {
  /** Active seconds actually consumed; 0 when blocked or frozen. */
  consumed: number;
  /** Set on the tick a year boundary is crossed. */
  birthdayReached: number | null;
}

export class LifeClock {
  private age: number;
  private progress = 0;
  private handledAge: number;
  private rateValue: LifeRate;
  private activeSecondsValue = 0;
  private readonly blocks = new Set<LifeBlockReason>();

  /**
   * Overflow past a year boundary, held rather than discarded.
   *
   * A birthday pauses progression until the game has finished handling it. The
   * seconds that took us past the boundary still happened, so they are carried
   * into the new year — otherwise a single long frame silently eats play time.
   */
  private carry = 0;

  private pending: number | null = null;

  constructor(startAge = MIN_AGE, rate: LifeRate = DEFAULT_LIFE_RATE) {
    this.age = clampAge(startAge);
    this.handledAge = this.age;
    this.rateValue = rate;
  }

  get ageYears(): number {
    return this.age;
  }

  get yearProgress(): number {
    return this.progress;
  }

  get rate(): LifeRate {
    return this.rateValue;
  }

  get activeSeconds(): number {
    return this.activeSecondsValue;
  }

  get isFrozen(): boolean {
    return this.rateValue === 'frozen';
  }

  /** Seconds of active play per in-game year at the current rate. */
  get secondsPerYear(): number {
    return this.rateValue === 'frozen' ? Number.POSITIVE_INFINITY : this.rateValue * 60;
  }

  /** A birthday has been reached and is waiting to be handled. */
  get pendingBirthday(): number | null {
    return this.pending;
  }

  get isBlocked(): boolean {
    return this.blocks.size > 0;
  }

  get blockReasons(): readonly LifeBlockReason[] {
    return [...this.blocks].sort();
  }

  block(reason: LifeBlockReason): void {
    this.blocks.add(reason);
  }

  unblock(reason: LifeBlockReason): void {
    this.blocks.delete(reason);
  }

  setBlocked(reason: LifeBlockReason, on: boolean): void {
    if (on) this.block(reason);
    else this.unblock(reason);
  }

  /**
   * Change the ageing rate.
   *
   * Progress through the current year is preserved as a *fraction*, not as
   * seconds: switching from 60 to 120 minutes per year should not throw away
   * half a year already lived, nor jump the character forward.
   */
  setRate(rate: LifeRate): void {
    this.rateValue = rate;
  }

  /**
   * Feed active elapsed time. Returns what happened.
   *
   * Refuses time when blocked or frozen, and stops at the first year boundary:
   * the caller must acknowledge the birthday before life continues. That is
   * what makes "pause life progression, autosave, show the postcard" possible
   * without racing the next birthday.
   */
  advance(realSeconds: number): LifeTick {
    const idle: LifeTick = { consumed: 0, birthdayReached: null };

    if (!Number.isFinite(realSeconds) || realSeconds <= 0) return idle;
    if (this.isFrozen || this.isBlocked || this.pending !== null) return idle;
    if (this.age >= MAX_AGE) return idle;

    const perYear = this.secondsPerYear;
    const room = (1 - this.progress) * perYear;

    if (realSeconds < room) {
      this.progress += realSeconds / perYear;
      this.activeSecondsValue += realSeconds;
      return { consumed: realSeconds, birthdayReached: null };
    }

    // Boundary crossed. Consume exactly up to it, hold the rest.
    this.progress = 1;
    this.activeSecondsValue += room;
    this.carry = realSeconds - room;
    this.pending = this.age + 1;
    this.block('birthday');
    return { consumed: room, birthdayReached: this.pending };
  }

  /**
   * The game has finished handling the pending birthday: age up and resume.
   *
   * Idempotent by construction — `pending` is cleared, and `handledAge` records
   * the highest birthday completed, so a reload cannot replay it.
   */
  acknowledgeBirthday(): number | null {
    if (this.pending === null) return null;

    const reached = this.pending;
    this.pending = null;
    this.age = clampAge(reached);
    this.handledAge = this.age;
    this.progress = 0;
    this.unblock('birthday');

    // Spend the carried overflow now, which may immediately reach the next
    // birthday — that is how a long stall leaps several years without losing
    // time or firing them all at once.
    const carried = this.carry;
    this.carry = 0;
    if (carried > 0) this.advance(carried);

    return this.age;
  }

  /** True if this birthday has already been handled. Guards replay on load. */
  hasHandled(age: number): boolean {
    return age <= this.handledAge;
  }

  /**
   * Force a birthday without waiting an hour. Test and developer use only —
   * exposed through the `?e2e=1` bridge, never in normal play.
   */
  forceBirthday(): number | null {
    if (this.isFrozen || this.age >= MAX_AGE) return null;
    if (this.pending !== null) return this.pending;
    this.progress = 1;
    this.pending = this.age + 1;
    this.block('birthday');
    return this.pending;
  }

  snapshot(): LifeClockSnapshot {
    return {
      ageYears: this.age,
      yearProgress: this.progress,
      lastHandledAge: this.handledAge,
      rate: this.rateValue,
      activeSeconds: this.activeSecondsValue,
    };
  }

  /**
   * Restore from a save.
   *
   * A pending birthday is *not* restored: if the game closed mid-birthday, the
   * safe reading is that it was not finished, so progress sits at the boundary
   * and the birthday fires once on the next tick. `lastHandledAge` is what
   * stops an already-completed one repeating.
   */
  restore(s: LifeClockSnapshot): void {
    this.age = clampAge(s.ageYears);
    this.progress = clamp01(s.yearProgress);
    this.handledAge = Math.max(clampAge(s.lastHandledAge), MIN_AGE);
    this.rateValue = s.rate;
    this.activeSecondsValue = Math.max(0, s.activeSeconds);
    this.carry = 0;
    this.pending = null;
    this.blocks.delete('birthday');

    // Exactly at a boundary with the birthday unhandled: re-arm it.
    if (this.progress >= 1 && this.handledAge <= this.age) {
      this.pending = Math.min(this.age + 1, MAX_AGE);
      this.block('birthday');
    }
  }
}

function clampAge(age: number): number {
  if (!Number.isFinite(age)) return MIN_AGE;
  return Math.min(MAX_AGE, Math.max(MIN_AGE, Math.floor(age)));
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
