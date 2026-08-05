import type { TimeMode } from '../Settings';

/**
 * The day/night scalar — presentation only.
 *
 * Separate from `LifeClock` on purpose. These two used to be the same idea in
 * most life sims and it always goes wrong: locking the sky to dusk for a
 * screenshot would freeze the character's lifespan, and speeding up ageing
 * would turn the day into a strobe. A day here is a fixed number of real
 * seconds regardless of how fast the player is ageing.
 *
 * `Environment` still owns the *look* — sun angle, fog, sky colours. This owns
 * only the number, so it can be saved, restored and stepped deterministically.
 */

/** Real seconds for one full in-game day at `cycle` mode. */
export const DAY_LENGTH_SECONDS = 20 * 60;

/** Mid-afternoon. A sun overhead flattens every facade. */
export const DEFAULT_WORLD_TIME = 0.615;

/** Frozen positions for the non-cycling modes. */
export const TIME_FOR_MODE: Record<Exclude<TimeMode, 'cycle'>, number> = {
  day: DEFAULT_WORLD_TIME,
  dusk: 0.8,
  night: 0.03,
};

export interface WorldClockSnapshot {
  /** 0..1, 0.5 = noon. */
  time: number;
  mode: TimeMode;
  /** Whole days elapsed, so "day 3" survives a reload. */
  day: number;
}

export class WorldClock {
  private timeValue = DEFAULT_WORLD_TIME;
  private modeValue: TimeMode = 'cycle';
  private dayValue = 1;
  private paused = false;

  get time(): number {
    return this.timeValue;
  }

  get mode(): TimeMode {
    return this.modeValue;
  }

  get day(): number {
    return this.dayValue;
  }

  get isCycling(): boolean {
    return this.modeValue === 'cycle' && !this.paused;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  setMode(mode: TimeMode): void {
    this.modeValue = mode;
    if (mode !== 'cycle') this.timeValue = TIME_FOR_MODE[mode];
  }

  /** Snap the clock, e.g. after sleeping. Does not change mode. */
  jumpTo(t: number): void {
    const wrapped = wrap01(t);
    // Crossing midnight backwards means a new day began.
    if (wrapped < this.timeValue) this.dayValue += 1;
    this.timeValue = wrapped;
  }

  /** Advance by real seconds. Only moves in `cycle` mode. */
  advance(realSeconds: number): void {
    if (!this.isCycling) return;
    if (!Number.isFinite(realSeconds) || realSeconds <= 0) return;
    const next = this.timeValue + realSeconds / DAY_LENGTH_SECONDS;
    if (next >= 1) this.dayValue += Math.floor(next);
    this.timeValue = wrap01(next);
  }

  /** `07:30`-style label for the HUD. */
  clockLabel(): string {
    const totalMinutes = Math.round(this.timeValue * 24 * 60) % (24 * 60);
    const h = Math.floor(totalMinutes / 60);
    const m = totalMinutes % 60;
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }

  snapshot(): WorldClockSnapshot {
    return { time: this.timeValue, mode: this.modeValue, day: this.dayValue };
  }

  restore(s: WorldClockSnapshot): void {
    this.timeValue = wrap01(s.time);
    this.modeValue = s.mode;
    this.dayValue = Math.max(1, Math.floor(s.day));
  }
}

function wrap01(v: number): number {
  if (!Number.isFinite(v)) return DEFAULT_WORLD_TIME;
  return ((v % 1) + 1) % 1;
}
