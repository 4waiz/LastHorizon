/**
 * Fixed-step simulation clock with render interpolation.
 *
 * The existing loop feeds a variable `dt` straight into the simulation, which
 * is fine for a character motor tuned around it but is the wrong foundation
 * for physics: Rapier, vehicle handling and any deterministic replay all
 * require a constant step. A variable step also makes behaviour depend on
 * frame rate, so a fast machine and a slow one disagree.
 *
 * This accumulates real time and emits whole steps of exactly `stepSeconds`,
 * leaving a fractional remainder (`alpha`) that render code can use to
 * interpolate between the previous and current simulation states — otherwise
 * a 60 Hz simulation on a 144 Hz display visibly stutters.
 *
 * Pure and DOM-free so it can be unit-tested; visibility handling is wired by
 * the caller.
 */

export interface SimulationClockOptions {
  /** Seconds per simulation step. Default 1/60. */
  stepSeconds?: number;
  /**
   * Most steps allowed in one frame. Without this, a long stall (tab hidden,
   * GC pause, breakpoint) accumulates a huge backlog and the next frame tries
   * to run it all at once — the "spiral of death", where catching up costs
   * more time than it recovers.
   */
  maxStepsPerFrame?: number;
}

export interface ClockTick {
  /** Whole simulation steps to run this frame. */
  readonly steps: number;
  /** Seconds per step; constant. */
  readonly dt: number;
  /** 0..1 remainder for render interpolation. */
  readonly alpha: number;
  /** True when a backlog was discarded to avoid a spiral. */
  readonly clamped: boolean;
}

/** Guards against float drift swallowing a step that is arithmetically due. */
const STEP_EPSILON = 1e-9;

export class SimulationClock {
  readonly stepSeconds: number;
  private readonly maxSteps: number;

  private accumulator = 0;
  private paused = false;
  private totalSteps = 0;
  private simSeconds = 0;

  constructor(opts: SimulationClockOptions = {}) {
    this.stepSeconds = opts.stepSeconds ?? 1 / 60;
    this.maxSteps = opts.maxStepsPerFrame ?? 5;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  /** Total simulated time, in seconds. Advances only via whole steps. */
  get simulatedSeconds(): number {
    return this.simSeconds;
  }

  get stepCount(): number {
    return this.totalSteps;
  }

  /** Interpolation factor for the current partial step. */
  get alpha(): number {
    return this.accumulator / this.stepSeconds;
  }

  pause(): void {
    this.paused = true;
  }

  /**
   * Resume. The accumulator is dropped: time spent paused or hidden is not
   * owed to the simulation, and replaying it would teleport everything.
   */
  resume(): void {
    this.paused = false;
    this.accumulator = 0;
  }

  setPaused(paused: boolean): void {
    if (paused === this.paused) return;
    if (paused) this.pause();
    else this.resume();
  }

  /** Drop any partial step without changing pause state. */
  reset(): void {
    this.accumulator = 0;
  }

  /**
   * Feed real elapsed seconds; get back how many fixed steps to run.
   * Negative or non-finite input is ignored rather than trusted.
   */
  advance(realSeconds: number): ClockTick {
    if (this.paused || !Number.isFinite(realSeconds) || realSeconds <= 0) {
      return { steps: 0, dt: this.stepSeconds, alpha: this.alpha, clamped: false };
    }

    this.accumulator += realSeconds;

    // Nudge by an epsilon before flooring. Accumulating and subtracting
    // fractions leaves the accumulator a hair under a whole step
    // (0.25 - 0.2 + 0.05 = 0.0999...), and without this a step that is
    // arithmetically due gets deferred a frame by float error alone.
    let steps = Math.floor((this.accumulator + STEP_EPSILON) / this.stepSeconds);
    let clamped = false;

    if (steps > this.maxSteps) {
      steps = this.maxSteps;
      clamped = true;
      // Discard the backlog rather than carry it: the game is already behind,
      // and owing it more work makes the next frame worse.
      this.accumulator = 0;
    } else {
      // Never let the epsilon push the accumulator negative.
      this.accumulator = Math.max(0, this.accumulator - steps * this.stepSeconds);
    }

    this.totalSteps += steps;
    this.simSeconds += steps * this.stepSeconds;

    return { steps, dt: this.stepSeconds, alpha: this.alpha, clamped };
  }
}
