/**
 * Locomotion state machine.
 *
 * Deliberately free of Three.js so it can be unit tested directly. The
 * animator maps whatever state comes out of here onto a clip.
 */

export type PlayerState = 'idle' | 'walk' | 'run' | 'jump' | 'fall' | 'land';

export interface StateInput {
  grounded: boolean;
  /** Horizontal speed in m/s. */
  planarSpeed: number;
  jumpTriggered: boolean;
  /** Seconds airborne. */
  airTime: number;
  justLanded: boolean;
  /** Downward speed at the moment of contact, m/s. */
  impactSpeed: number;
}

/** Hysteresis band so a character hovering at the threshold doesn't flicker. */
export const WALK_ENTER = 0.16;
export const WALK_EXIT = 0.08;
export const RUN_ENTER = 2.45;
export const RUN_EXIT = 2.05;

/** Minimum time the jump pose holds before it can become a fall. */
export const JUMP_MIN_TIME = 0.22;
/** Airborne grace before the fall clip takes over (also the coyote window). */
export const FALL_DELAY = 0.13;
/** How long the landing crouch plays. */
export const LAND_TIME = 0.26;
/** Impacts softer than this skip the landing clip entirely. */
export const LAND_IMPACT_THRESHOLD = 4.0;

export class PlayerStateMachine {
  state: PlayerState = 'idle';
  timeInState = 0;
  /** Set for one update when the state changed. */
  changed = false;

  reset(state: PlayerState = 'idle'): void {
    this.state = state;
    this.timeInState = 0;
    this.changed = false;
  }

  private to(next: PlayerState): void {
    if (next === this.state) return;
    this.state = next;
    this.timeInState = 0;
    this.changed = true;
  }

  /** Pick the ground state for a given speed, honouring hysteresis. */
  private groundState(speed: number): PlayerState {
    const s = this.state;
    if (s === 'run') return speed < RUN_EXIT ? (speed < WALK_EXIT ? 'idle' : 'walk') : 'run';
    if (s === 'walk') {
      if (speed >= RUN_ENTER) return 'run';
      return speed < WALK_EXIT ? 'idle' : 'walk';
    }
    if (speed >= RUN_ENTER) return 'run';
    return speed >= WALK_ENTER ? 'walk' : 'idle';
  }

  update(dt: number, input: StateInput): PlayerState {
    this.changed = false;
    this.timeInState += dt;

    // A jump always wins — it is the one state the player asked for directly.
    if (input.jumpTriggered) {
      this.to('jump');
      return this.state;
    }

    switch (this.state) {
      case 'jump':
        if (input.grounded && this.timeInState > 0.05) {
          this.to(this.landingOrGround(input));
        } else if (this.timeInState >= JUMP_MIN_TIME) {
          this.to('fall');
        }
        break;

      case 'fall':
        if (input.grounded) this.to(this.landingOrGround(input));
        break;

      case 'land':
        if (!input.grounded && input.airTime > FALL_DELAY) {
          this.to('fall');
        } else if (this.timeInState >= LAND_TIME || input.planarSpeed >= RUN_EXIT) {
          this.to(this.groundState(input.planarSpeed));
        }
        break;

      default:
        if (!input.grounded && input.airTime > FALL_DELAY) {
          this.to('fall');
        } else if (input.justLanded && input.impactSpeed >= LAND_IMPACT_THRESHOLD) {
          this.to('land');
        } else {
          this.to(this.groundState(input.planarSpeed));
        }
        break;
    }

    return this.state;
  }

  private landingOrGround(input: StateInput): PlayerState {
    if (input.impactSpeed >= LAND_IMPACT_THRESHOLD) return 'land';
    return this.groundState(input.planarSpeed);
  }
}
