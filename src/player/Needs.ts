/**
 * Hunger, energy, cleanliness and mood.
 *
 * The brief is explicit that this must not become a survival grind, and the
 * numbers here are the part that decides that. Each need takes **hours of
 * active play** to fall from full to empty, so a player can drive across the
 * city, do a job and come back without a bar interrupting them. Nothing is ever
 * fatal, and nothing hard-blocks an action — a low need is a mild penalty and
 * a high one a mild bonus.
 *
 * Every need can be individually slowed or switched off, because "I do not
 * want to think about this" is a legitimate way to play and an accessibility
 * requirement, not a cheat.
 *
 * Pure: fed active seconds by the caller, exactly like the life clock.
 */

export type NeedId = 'hunger' | 'energy' | 'cleanliness' | 'mood';

export const NEED_IDS: readonly NeedId[] = ['hunger', 'energy', 'cleanliness', 'mood'];

/**
 * Real minutes of active play for a full need to reach empty.
 *
 * Energy is the slowest because sleeping is the fix and beds are not always to
 * hand; hunger is fastest because food is cheap and everywhere.
 */
export const DRAIN_MINUTES: Readonly<Record<NeedId, number>> = {
  hunger: 90,
  energy: 240,
  cleanliness: 180,
  mood: 150,
};

export type NeedsState = Record<NeedId, number>;

export interface NeedsSettings {
  /** Per-need switch. Off means it neither decays nor penalises. */
  readonly enabled: Readonly<Record<NeedId, boolean>>;
  /**
   * Global decay multiplier. 1 is normal, 0.5 is half speed, 0 is frozen —
   * the accessibility slider, not a difficulty setting.
   */
  readonly decayScale: number;
}

export const DEFAULT_NEEDS_SETTINGS: NeedsSettings = {
  enabled: { hunger: true, energy: true, cleanliness: true, mood: true },
  decayScale: 1,
};

/** Below this a need starts to nag; above the high mark it helps. */
export const LOW_MARK = 0.25;
export const HIGH_MARK = 0.8;

export interface NeedModifiers {
  /** Multiplier on run speed. 1 is normal. */
  readonly moveSpeed: number;
  /** Multiplier on how fast stamina-ish actions recover. */
  readonly recovery: number;
  /** Needs currently below the low mark, worst first. */
  readonly lacking: readonly NeedId[];
}

export class Needs {
  private values: NeedsState = { hunger: 1, energy: 1, cleanliness: 1, mood: 1 };
  private settings: NeedsSettings = DEFAULT_NEEDS_SETTINGS;

  get state(): Readonly<NeedsState> {
    return this.values;
  }

  value(id: NeedId): number {
    return this.values[id];
  }

  get config(): NeedsSettings {
    return this.settings;
  }

  configure(settings: Partial<NeedsSettings>): void {
    this.settings = {
      enabled: { ...this.settings.enabled, ...(settings.enabled ?? {}) },
      decayScale:
        settings.decayScale === undefined
          ? this.settings.decayScale
          : Math.max(0, settings.decayScale),
    };
  }

  setEnabled(id: NeedId, on: boolean): void {
    this.configure({ enabled: { ...this.settings.enabled, [id]: on } });
  }

  /**
   * Decay by active seconds.
   *
   * A disabled need is left exactly where it was rather than pinned to full —
   * turning it off mid-run should not silently grant a top-up, and turning it
   * back on should resume from where it stopped.
   */
  advance(activeSeconds: number): void {
    if (!Number.isFinite(activeSeconds) || activeSeconds <= 0) return;
    if (this.settings.decayScale === 0) return;

    for (const id of NEED_IDS) {
      if (!this.settings.enabled[id]) continue;
      const perSecond = 1 / (DRAIN_MINUTES[id] * 60);
      this.values[id] = clamp01(
        this.values[id] - activeSeconds * perSecond * this.settings.decayScale,
      );
    }
  }

  /** Top a need up. Values are 0..1 fractions of the whole bar. */
  restore(id: NeedId, amount: number): void {
    if (!Number.isFinite(amount) || amount <= 0) return;
    this.values[id] = clamp01(this.values[id] + amount);
  }

  /** Apply a food item's restores, or a shower, or a night's sleep. */
  restoreMany(restores: Partial<Record<NeedId, number>>): void {
    for (const [id, amount] of Object.entries(restores)) {
      if (amount !== undefined) this.restore(id as NeedId, amount);
    }
  }

  /** Sleeping fills energy and helps mood; it does not feed you. */
  sleep(): void {
    this.restore('energy', 1);
    this.restore('mood', 0.25);
  }

  shower(): void {
    this.restore('cleanliness', 1);
    this.restore('mood', 0.1);
  }

  /**
   * Effects of the current state.
   *
   * Deliberately gentle: the worst case is a 15% slower run, which reads as
   * "you are tired" rather than "you are being punished". A disabled need
   * never contributes.
   */
  modifiers(): NeedModifiers {
    const lacking: NeedId[] = [];
    let speed = 1;
    let recovery = 1;

    for (const id of NEED_IDS) {
      if (!this.settings.enabled[id]) continue;
      const v = this.values[id];

      if (v < LOW_MARK) {
        lacking.push(id);
        // Scales in over the low band rather than snapping at the threshold.
        const severity = (LOW_MARK - v) / LOW_MARK;
        if (id === 'energy') speed -= 0.1 * severity;
        if (id === 'hunger') speed -= 0.05 * severity;
        if (id === 'mood') recovery -= 0.2 * severity;
      } else if (v > HIGH_MARK) {
        if (id === 'energy') recovery += 0.1;
        if (id === 'mood') recovery += 0.1;
      }
    }

    lacking.sort((a, b) => this.values[a] - this.values[b]);
    return {
      moveSpeed: Math.max(0.85, speed),
      recovery: Math.max(0.5, recovery),
      lacking,
    };
  }

  toJSON(): NeedsState {
    return { ...this.values };
  }

  restoreFrom(data: Partial<NeedsState>): void {
    for (const id of NEED_IDS) {
      const v = data[id];
      if (typeof v === 'number' && Number.isFinite(v)) this.values[id] = clamp01(v);
    }
  }
}

function clamp01(v: number): number {
  if (!Number.isFinite(v)) return 0;
  return Math.min(1, Math.max(0, v));
}
