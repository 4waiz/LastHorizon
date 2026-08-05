/**
 * Chapter and quest time.
 *
 * The third independent clock. Some quests need a real deadline ("be at the
 * grocery before it shuts"), and those cannot run on `LifeClock` — a player who
 * sets ageing to `frozen` would freeze every timer with it, and one who sets
 * 30 minutes per year would halve every deadline. Nor on `WorldClock`, since
 * locking the sky to dusk would stop them dead.
 *
 * So: plain active seconds, per chapter, with named timers that can be started,
 * cancelled and asked whether they have expired.
 */

export interface StoryTimerSnapshot {
  id: string;
  remaining: number;
}

export interface StoryClockSnapshot {
  chapter: number;
  /** Active seconds spent in the current chapter. */
  chapterSeconds: number;
  /** Active seconds across the whole run. */
  totalSeconds: number;
  timers: StoryTimerSnapshot[];
}

export class StoryClock {
  private chapterValue = 1;
  private chapterSecondsValue = 0;
  private totalSecondsValue = 0;
  private paused = false;
  private readonly timers = new Map<string, number>();
  private readonly expiredThisTick: string[] = [];

  get chapter(): number {
    return this.chapterValue;
  }

  get chapterSeconds(): number {
    return this.chapterSecondsValue;
  }

  get totalSeconds(): number {
    return this.totalSecondsValue;
  }

  setPaused(paused: boolean): void {
    this.paused = paused;
  }

  /** Move to a chapter, resetting its elapsed time. Timers do not carry over. */
  setChapter(chapter: number): void {
    if (chapter === this.chapterValue) return;
    this.chapterValue = Math.max(1, Math.floor(chapter));
    this.chapterSecondsValue = 0;
    this.timers.clear();
  }

  /** Start (or restart) a named countdown, in active seconds. */
  startTimer(id: string, seconds: number): void {
    if (!Number.isFinite(seconds) || seconds <= 0) return;
    this.timers.set(id, seconds);
  }

  cancelTimer(id: string): void {
    this.timers.delete(id);
  }

  remaining(id: string): number | null {
    return this.timers.get(id) ?? null;
  }

  hasTimer(id: string): boolean {
    return this.timers.has(id);
  }

  /**
   * Advance by active seconds. Returns the ids of timers that expired on this
   * tick — returned rather than fired via callback so the caller controls
   * ordering against saves and quest state.
   */
  advance(realSeconds: number): readonly string[] {
    this.expiredThisTick.length = 0;
    if (this.paused) return this.expiredThisTick;
    if (!Number.isFinite(realSeconds) || realSeconds <= 0) return this.expiredThisTick;

    this.chapterSecondsValue += realSeconds;
    this.totalSecondsValue += realSeconds;

    for (const [id, left] of this.timers) {
      const next = left - realSeconds;
      if (next <= 0) {
        this.timers.delete(id);
        this.expiredThisTick.push(id);
      } else {
        this.timers.set(id, next);
      }
    }
    // Deterministic order regardless of Map insertion order.
    this.expiredThisTick.sort();
    return this.expiredThisTick;
  }

  snapshot(): StoryClockSnapshot {
    return {
      chapter: this.chapterValue,
      chapterSeconds: this.chapterSecondsValue,
      totalSeconds: this.totalSecondsValue,
      timers: [...this.timers].map(([id, remaining]) => ({ id, remaining })).sort((a, b) =>
        a.id < b.id ? -1 : a.id > b.id ? 1 : 0,
      ),
    };
  }

  restore(s: StoryClockSnapshot): void {
    this.chapterValue = Math.max(1, Math.floor(s.chapter));
    this.chapterSecondsValue = Math.max(0, s.chapterSeconds);
    this.totalSecondsValue = Math.max(0, s.totalSeconds);
    this.timers.clear();
    for (const t of s.timers) {
      if (t.remaining > 0) this.timers.set(t.id, t.remaining);
    }
  }
}
