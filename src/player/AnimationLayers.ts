import * as THREE from 'three';

/**
 * Concurrent animation layers over one mixer.
 *
 * Three.js has no bone masking, so the masking is done **in the clips**: an
 * upper-body clip authored in Blender keys only spine, arm and hand bones, so
 * it can play at full weight beside a locomotion clip without either fighting
 * the other. The layer system's job is therefore weights and fades, not
 * filtering — which is why it is this small.
 *
 * Layers, lowest first:
 *   locomotion  idle / walk / run / jump / fall / land / sit — one at a time
 *   upperBody   carry, phone, wave — optional, fades over the base
 *   additive    look / aim offsets, applied on top of whatever is playing
 *   facial      blink, driven directly on the morph (see PlayerAnimator)
 *
 * Foot placement is procedural and lives in `footOffset` below rather than in
 * a clip, because the ground it has to match is not known when the clip is
 * authored.
 */

export type LayerId = 'locomotion' | 'upperBody' | 'additive';

export interface LayerOptions {
  readonly loop?: boolean;
  readonly fadeSeconds?: number;
  readonly timeScale?: number;
}

interface Slot {
  action: THREE.AnimationAction | null;
  name: string | null;
  /** Where the weight is heading, so a fade can be interrupted cleanly. */
  targetWeight: number;
  fadeSpeed: number;
}

const DEFAULT_FADE = 0.2;

export class AnimationLayers {
  private readonly actions = new Map<string, THREE.AnimationAction>();
  /** Additive conversions of the same clips; see `additiveAction`. */
  private readonly additiveActions = new Map<string, THREE.AnimationAction>();
  private readonly slots: Record<LayerId, Slot> = {
    locomotion: { action: null, name: null, targetWeight: 1, fadeSpeed: 1 / DEFAULT_FADE },
    upperBody: { action: null, name: null, targetWeight: 0, fadeSpeed: 1 / DEFAULT_FADE },
    additive: { action: null, name: null, targetWeight: 0, fadeSpeed: 1 / DEFAULT_FADE },
  };

  constructor(
    readonly mixer: THREE.AnimationMixer,
    clips: readonly THREE.AnimationClip[],
  ) {
    for (const clip of clips) {
      const a = this.mixer.clipAction(clip);
      a.enabled = true;
      this.actions.set(clip.name, a);
    }
  }

  has(name: string): boolean {
    return this.actions.has(name);
  }

  get clipNames(): string[] {
    return [...this.actions.keys()].sort();
  }

  playing(layer: LayerId): string | null {
    return this.slots[layer].name;
  }

  weight(layer: LayerId): number {
    return this.slots[layer].action?.getEffectiveWeight() ?? 0;
  }

  /**
   * The additive form of a clip, built once and cached.
   *
   * `makeClipAdditive` subtracts the reference frame from the track values *in
   * place* and has no idempotency guard, so calling it on the live clip is
   * wrong twice over: replaying an additive clip after it was stopped would
   * subtract the reference a second time and the pose would drift further from
   * rest each time, and the same clip could never be played normally again —
   * including by anything else sharing the GLB's clips.
   *
   * Converting a clone avoids both. Returns null for an unknown clip.
   */
  private additiveAction(name: string): THREE.AnimationAction | null {
    const cached = this.additiveActions.get(name);
    if (cached) return cached;

    const source = this.actions.get(name);
    if (!source) return null;

    const clip = source.getClip().clone();
    clip.name = `${name}__additive`;
    THREE.AnimationUtils.makeClipAdditive(clip);

    const action = this.mixer.clipAction(clip);
    action.enabled = true;
    action.blendMode = THREE.AdditiveAnimationBlendMode;
    this.additiveActions.set(name, action);
    return action;
  }

  /**
   * Start a clip on a layer, crossfading from whatever it was playing.
   *
   * Returns false for an unknown clip rather than throwing: a missing optional
   * animation should degrade to "no upper-body action", not crash the frame.
   */
  play(layer: LayerId, name: string, opts: LayerOptions = {}): boolean {
    const slot = this.slots[layer];
    if (slot.name === name) return true;

    const next = layer === 'additive' ? this.additiveAction(name) : this.actions.get(name);
    if (!next) return false;

    const fade = opts.fadeSeconds ?? DEFAULT_FADE;
    const previous = slot.action;

    next.reset();
    next.enabled = true;
    next.setLoop(opts.loop === false ? THREE.LoopOnce : THREE.LoopRepeat, opts.loop === false ? 1 : Infinity);
    next.clampWhenFinished = opts.loop === false;
    next.setEffectiveTimeScale(opts.timeScale ?? 1);

    if (previous && previous !== next && fade > 0) {
      next.setEffectiveWeight(0);
      next.play();
      next.crossFadeFrom(previous, fade, true);
    } else {
      next.setEffectiveWeight(layer === 'locomotion' ? 1 : slot.targetWeight);
      next.play();
    }

    slot.action = next;
    slot.name = name;
    slot.fadeSpeed = fade > 0 ? 1 / fade : Number.POSITIVE_INFINITY;
    if (layer === 'locomotion') slot.targetWeight = 1;
    return true;
  }

  /** Set where a layer's weight is heading. The ramp happens in `update`. */
  setWeight(layer: LayerId, weight: number, fadeSeconds = DEFAULT_FADE): void {
    const slot = this.slots[layer];
    slot.targetWeight = Math.min(1, Math.max(0, weight));
    slot.fadeSpeed = fadeSeconds > 0 ? 1 / fadeSeconds : Number.POSITIVE_INFINITY;
  }

  /** Fade a layer out and release it once it reaches zero. */
  stop(layer: LayerId, fadeSeconds = DEFAULT_FADE): void {
    this.setWeight(layer, 0, fadeSeconds);
  }

  setTimeScale(layer: LayerId, scale: number): void {
    this.slots[layer].action?.setEffectiveTimeScale(scale);
  }

  /**
   * Advance weights, then the mixer.
   *
   * Weights are ramped here rather than by `crossFadeTo` so an interrupted
   * fade resolves from wherever it actually was — fading a carry-out halfway
   * and then back in should not snap to zero first, which is what popping
   * looks like.
   */
  update(dt: number): void {
    for (const layer of ['locomotion', 'upperBody', 'additive'] as const) {
      const slot = this.slots[layer];
      if (!slot.action) continue;

      const current = slot.action.getEffectiveWeight();
      if (current !== slot.targetWeight) {
        const step = slot.fadeSpeed * dt;
        const next =
          current < slot.targetWeight
            ? Math.min(slot.targetWeight, current + step)
            : Math.max(slot.targetWeight, current - step);
        slot.action.setEffectiveWeight(next);

        if (next === 0 && slot.targetWeight === 0) {
          slot.action.stop();
          slot.action = null;
          slot.name = null;
        }
      }
    }
    this.mixer.update(dt);
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const a of this.actions.values()) this.mixer.uncacheAction(a.getClip());
    for (const a of this.additiveActions.values()) {
      const clip = a.getClip();
      this.mixer.uncacheAction(clip);
      this.mixer.uncacheClip(clip);
    }
    this.actions.clear();
    this.additiveActions.clear();
    for (const layer of ['locomotion', 'upperBody', 'additive'] as const) {
      this.slots[layer].action = null;
      this.slots[layer].name = null;
    }
  }
}

/**
 * Procedural foot placement.
 *
 * How far to lift a foot so it meets the ground the clip did not know about.
 * The clip keys a flat walk; on a slope the trailing foot floats and the
 * leading one sinks. Returned as an offset rather than applied here so the
 * caller owns the raycast.
 *
 * Clamped hard: past a few centimetres this stops reading as "standing on a
 * slope" and starts reading as a broken leg, so beyond the limit it is better
 * to let the foot clip than to bend the knee backwards.
 */
export const MAX_FOOT_LIFT = 0.12;

export function footOffset(groundY: number, footY: number, blend = 1): number {
  if (!Number.isFinite(groundY) || !Number.isFinite(footY)) return 0;
  const raw = groundY - footY;
  const clamped = Math.min(MAX_FOOT_LIFT, Math.max(-MAX_FOOT_LIFT, raw));
  return clamped * Math.min(1, Math.max(0, blend));
}
