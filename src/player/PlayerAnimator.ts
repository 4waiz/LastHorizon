import * as THREE from 'three';
import { clamp } from '../utils/MathUtils';
import { PlayerState } from './PlayerStateMachine';

/**
 * Drives the Blender-authored clips from the state machine.
 *
 * Playback rate for the locomotion cycles is tied to ground speed against the
 * speed each cycle was keyed for, which is what keeps the feet from skating.
 * The rate is clamped so an extreme value never turns the walk into a blur.
 */

/** Ground speeds the Blender walk/run cycles were authored around, m/s. */
export const WALK_DESIGN_SPEED = 1.24;
export const RUN_DESIGN_SPEED = 3.15;

const CLIP_FOR: Record<PlayerState, string> = {
  idle: 'Idle',
  walk: 'Walk',
  run: 'Run',
  jump: 'JumpStart',
  fall: 'Fall',
  land: 'Land',
};

const LOOPING: Record<PlayerState, boolean> = {
  idle: true,
  walk: true,
  run: true,
  jump: false,
  fall: true,
  land: false,
};

/** Per-target crossfade, seconds. Snappy into jump, soft back into idle. */
const FADE_TO: Record<PlayerState, number> = {
  idle: 0.22,
  walk: 0.17,
  run: 0.15,
  jump: 0.07,
  fall: 0.16,
  land: 0.08,
};

export class PlayerAnimator {
  readonly mixer: THREE.AnimationMixer;
  private actions = new Map<string, THREE.AnimationAction>();
  private currentState: PlayerState | null = null;
  private current: THREE.AnimationAction | null = null;

  readonly missing: string[] = [];

  constructor(root: THREE.Object3D, clips: THREE.AnimationClip[]) {
    this.mixer = new THREE.AnimationMixer(root);
    for (const clip of clips) {
      const action = this.mixer.clipAction(clip);
      action.enabled = true;
      this.actions.set(clip.name, action);
    }
    for (const name of Object.values(CLIP_FOR)) {
      if (!this.actions.has(name)) this.missing.push(name);
    }
  }

  get available(): string[] {
    return [...this.actions.keys()];
  }

  /** Resolve a state to a real action, degrading to Idle if a clip is absent. */
  private resolve(state: PlayerState): THREE.AnimationAction | null {
    return this.actions.get(CLIP_FOR[state]) ?? this.actions.get('Idle') ?? null;
  }

  play(state: PlayerState, force = false): void {
    if (state === this.currentState && !force) return;
    const next = this.resolve(state);
    if (!next) return;

    next.reset();
    next.enabled = true;
    next.setEffectiveWeight(1);
    if (LOOPING[state]) {
      next.setLoop(THREE.LoopRepeat, Infinity);
      next.clampWhenFinished = false;
    } else {
      next.setLoop(THREE.LoopOnce, 1);
      next.clampWhenFinished = true;
    }

    if (this.current && this.current !== next) {
      next.crossFadeFrom(this.current, FADE_TO[state], true);
    }
    next.play();

    this.current = next;
    this.currentState = state;
  }

  /**
   * @param speed  current horizontal speed, m/s
   * @param dt     seconds; the mixer is stepped here
   */
  update(dt: number, state: PlayerState, speed: number): void {
    this.play(state);

    if (this.current) {
      let rate = 1;
      if (state === 'walk') {
        rate = clamp(speed / WALK_DESIGN_SPEED, 0.55, 1.75);
      } else if (state === 'run') {
        rate = clamp(speed / RUN_DESIGN_SPEED, 0.75, 1.6);
      }
      this.current.setEffectiveTimeScale(rate);
    }

    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const a of this.actions.values()) this.mixer.uncacheAction(a.getClip());
    this.actions.clear();
    this.current = null;
    this.currentState = null;
  }
}
