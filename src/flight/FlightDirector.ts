import {
  FlightModel,
  NEUTRAL_INPUT,
  PLANE_TUNING,
  type AssistLevel,
  type FlightHost,
  type FlightInput,
  type FlightState as FlightSnapshot,
} from './FlightModel';
import {
  evaluate,
  nearestCheckpoint,
  FLIGHT_CORRIDOR,
  type BoundaryVerdict,
} from './WorldBounds';
import type { FlightState } from './FlightState';

/**
 * Flying, driven from the game.
 *
 * The same arrangement `CombatDirector` uses and for the same reason: it is
 * the only thing that mutates flight state, so there is one place to look when
 * an aeroplane ends up in a hedge. `Game` holds one of these and calls four
 * methods — `update`, `board`, `leave` and `capture`.
 *
 * The split against `FlightModel` is worth stating, because it is the same
 * split that made the Phase 9 arrest testable: the **model** decides physics
 * and judges a touchdown; the **director** decides consequences and asks the
 * host to carry them out. Nothing here integrates a force and nothing in the
 * model knows what a checkpoint is.
 */

export interface FlightDirectorHost extends FlightHost {
  /** Fade, move, and hand control back. Returns when the player can fly again. */
  recover(to: { x: number; y: number; z: number; facing: number }): Promise<void>;
  /** A line for the player. Boundary captions and crash notices come through here. */
  say(title: string, body: string): void;
  /** True while a panel, a cutscene or a transition owns the input. */
  readonly blocked: boolean;
}

/** How hard the turn-back nudge pushes, radians per second at full pressure. */
const NUDGE_RATE = 0.75;
/** Seconds between repeats of the same boundary caption. */
const CAPTION_COOLDOWN = 12;

export class FlightDirector {
  readonly model: FlightModel;

  private ridingValue = false;
  private lastCaption = '';
  private captionAge = CAPTION_COOLDOWN;
  private verdictValue: BoundaryVerdict = evaluate({ x: 0, y: 0, z: 0 });
  /** Set while a recovery is in flight, so a second one cannot start. */
  private recovering = false;

  constructor(
    private readonly state: FlightState,
    private readonly host: FlightDirectorHost,
  ) {
    this.model = new FlightModel(host, PLANE_TUNING);
    this.restoreFromState();
  }

  get riding(): boolean {
    return this.ridingValue;
  }

  get verdict(): BoundaryVerdict {
    return this.verdictValue;
  }

  get assist(): AssistLevel {
    return this.model.assist;
  }

  setAssist(level: AssistLevel): void {
    this.model.setAssist(level);
  }

  // -- persistence ----------------------------------------------------------

  private restoreFromState(): void {
    if (this.state.flight) {
      this.model.restore(this.state.flight);
    } else if (this.state.parked) {
      const p = this.state.parked;
      this.model.placeAt(p.x, p.z, p.facing);
    } else {
      // The aeroplane lives at the airstrip apron until somebody moves it.
      const home = nearestCheckpoint({ x: 200, y: 0, z: 0 }, 'air');
      this.model.placeAt(home.x, home.z, home.facing);
    }
    this.syncMirrors();
  }

  capture(): void {
    this.state.flight = this.model.toJSON();
    const s = this.model.state();
    this.state.parked = {
      x: s.position.x,
      y: s.position.y,
      z: s.position.z,
      facing: s.yaw,
    };
  }

  afterRestore(): void {
    this.ridingValue = false;
    this.restoreFromState();
  }

  private syncMirrors(): void {
    const s = this.model.state();
    this.state.airborne = !s.onGround && this.ridingValue;
    this.state.airspeed = s.airspeed;
    this.state.altitude = s.altitudeAgl;
    this.state.stallWarning = s.stallWarning && this.ridingValue;
    this.state.boundaryPressure = this.verdictValue.pressure;
  }

  // -- boarding -------------------------------------------------------------

  board(): boolean {
    if (this.ridingValue) return false;
    // Only from a stop, and only on the ground. Boarding a moving aeroplane is
    // not a thing, and boarding an airborne one is a bug.
    const s = this.model.state();
    if (!s.onGround || s.airspeed > 1.5) return false;
    this.ridingValue = true;
    this.syncMirrors();
    return true;
  }

  leave(): boolean {
    if (!this.ridingValue) return false;
    const s = this.model.state();
    if (!s.onGround || s.airspeed > 1.5) return false;
    this.ridingValue = false;
    this.capture();
    this.syncMirrors();
    return true;
  }

  // -- the frame ------------------------------------------------------------

  /**
   * One step.
   *
   * The aeroplane keeps flying while a panel is open only in the sense that
   * nothing explodes: the input is neutralised, so it glides. That is the
   * behaviour the pause rules already give cars, and an aeroplane that froze
   * mid-air and resumed would be worse than one that trimmed itself.
   */
  update(dt: number, input: FlightInput): void {
    if (!Number.isFinite(dt) || dt <= 0) return;

    const live = this.ridingValue && !this.host.blocked ? input : NEUTRAL_INPUT;
    const nudged = this.applyBoundary(dt, live);

    this.model.advance(dt, nudged);
    this.captionAge += dt;

    this.evaluateBoundary();
    this.checkFailure();
    this.syncMirrors();
  }

  /**
   * The turn-back nudge.
   *
   * Applied as *yaw input*, not as a rotation. The difference matters: a
   * player fighting the nudge wins, right up until `recovery` — which is the
   * whole point of the four-zone design. Shoving the heading directly would
   * be an invisible wall with a caption on it, which is worse than an
   * invisible wall because it lies.
   */
  private applyBoundary(dt: number, input: FlightInput): FlightInput {
    void dt;
    const v = this.verdictValue;
    if (v.zone !== 'turning' || !v.back || !this.ridingValue) return input;

    const s = this.model.state();
    // Angle between where the nose points and where home is, on the ground
    // plane. Positive means home is to the right.
    const want = Math.atan2(v.back.x, v.back.z);
    let delta = want - s.yaw;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;

    const push = Math.sign(delta) * Math.min(1, Math.abs(delta)) * v.pressure * NUDGE_RATE;
    return { ...input, roll: Math.max(-1, Math.min(1, input.roll + push)) };
  }

  private evaluateBoundary(): void {
    const before = this.verdictValue.zone;
    this.verdictValue = evaluate(this.model.state().position, FLIGHT_CORRIDOR);
    const v = this.verdictValue;

    if (!this.ridingValue) return;
    if (v.zone === 'inside') {
      this.lastCaption = '';
      return;
    }
    // Say it on entering a zone, and then at most every twelve seconds. A
    // caption every frame is noise, and noise is what players learn to ignore.
    const changed = v.zone !== before;
    if (v.caption && (changed || this.captionAge >= CAPTION_COOLDOWN)) {
      if (v.caption !== this.lastCaption || this.captionAge >= CAPTION_COOLDOWN) {
        this.host.say('Airspace', v.caption);
        this.lastCaption = v.caption;
        this.captionAge = 0;
      }
    }
  }

  /**
   * Crash, or out of the world.
   *
   * Both end the same way, because from the player's side they are the same
   * problem: the thing they were flying is somewhere they cannot fly it. This
   * is the Phase 5 argument about vehicle recovery, applied one storey up.
   */
  private checkFailure(): void {
    if (this.recovering) return;

    const crashed = this.model.crashed;
    const outside = this.verdictValue.zone === 'recovery';
    if (!crashed && !outside) return;

    this.recovering = true;
    this.model.clearCrash();
    this.state.recoveries++;

    const at = this.model.state().position;
    const to = nearestCheckpoint(at, 'air');
    if (crashed) {
      this.host.say('Bent it', 'Somebody towed it back to the strip.');
    } else if (this.verdictValue.reason === 'underworld') {
      this.host.say('Recovered', 'That is not somewhere you can be.');
    } else {
      this.host.say('Turned back', 'The strip is behind you now.');
    }

    void this.host
      .recover({ x: to.x, y: to.y, z: to.z, facing: to.facing })
      .then(() => {
        // Place *after* the host has faded and moved the player, so the two
        // cannot disagree about where the aeroplane ended up.
        this.model.placeAt(to.x, to.z, to.facing);
        this.capture();
        this.verdictValue = evaluate(this.model.state().position, FLIGHT_CORRIDOR);
        this.syncMirrors();
      })
      .finally(() => {
        this.recovering = false;
      });
  }

  // -- reading --------------------------------------------------------------

  snapshot(): FlightSnapshot {
    return this.model.state();
  }
}
