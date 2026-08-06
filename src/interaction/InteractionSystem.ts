/**
 * What the player can do, and when.
 *
 * Replaces a hard-coded scan that found the nearest thing with a `kind` field
 * and a `switch`. Two problems with that: adding an interactable meant editing
 * `Game`, and the prompt was chosen before anything checked whether the action
 * could actually run — so it could offer "Open the wardrobe" for a wardrobe
 * that was busy, then do nothing.
 *
 * Here every action declares its own availability, and **a prompt is only ever
 * built from an action that passed every check**: distance, facing,
 * availability. That is acceptance criterion 3 expressed as a data flow rather
 * than a rule to remember.
 *
 * Pure: positions are plain `{x,y,z}`, which `THREE.Vector3` satisfies
 * structurally, so the whole thing is testable without a renderer.
 */

export interface Point3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Whatever the game wants to hand actions at decision and execution time. */
export interface InteractionContext {
  readonly age: number;
  /** True while a transition, cutscene or panel is blocking play. */
  readonly busy: boolean;
  [key: string]: unknown;
}

export interface InteractionAction {
  readonly id: string;
  /** Localisable label. Shown verbatim; callers pass an already-resolved string. */
  readonly label: string;
  /** Higher wins when several are in range. Ties break on distance, then id. */
  readonly priority: number;
  /** Metres. Beyond this the action is not offered. */
  readonly maxDistance: number;
  /**
   * Radians of tolerance between where the player looks and where the
   * interactable is. `null` means facing does not matter — a bed does not care
   * which way you approach, a shop counter does.
   */
  readonly facingTolerance: number | null;
  /** Seconds the key must be held. 0 is a press. */
  readonly holdSeconds: number;
  /** Runtime gate: stock, age, ownership, whether the door is already open. */
  isAvailable(ctx: InteractionContext): boolean;
  execute(ctx: InteractionContext): void | Promise<void>;
  /** Called if a hold is released early, or the player walks away mid-hold. */
  cancel?(): void;
}

export interface Interactable {
  readonly id: string;
  /** Read each frame, so a moving interactable (a vehicle) works unchanged. */
  position(): Point3;
  readonly actions: readonly InteractionAction[];
}

export interface Candidate {
  readonly interactable: Interactable;
  readonly action: InteractionAction;
  readonly distance: number;
}

export interface InteractionState {
  /** The action that would run. Null when there is nothing to offer. */
  readonly primary: Candidate | null;
  /** Every offerable action, best first. */
  readonly candidates: readonly Candidate[];
  /** True when more than one *interactable* is offering something. */
  readonly needsSelector: boolean;
  /** 0..1 through the current hold. */
  readonly holdProgress: number;
  /** The label to show, or null. Never from an unavailable action. */
  readonly prompt: string | null;
}

const EMPTY: InteractionState = {
  primary: null,
  candidates: [],
  needsSelector: false,
  holdProgress: 0,
  prompt: null,
};

/** Shortest signed angle between two yaws, in radians. */
export function angleDelta(a: number, b: number): number {
  let d = (a - b) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}

export interface InteractionQuery {
  readonly position: Point3;
  /** Player yaw, glTF convention: atan2(dir.x, dir.z). */
  readonly facing: number;
  /** True while the interact control is held. */
  readonly held: boolean;
}

export class InteractionSystem {
  private readonly sources = new Map<string, Interactable>();

  private holdingId: string | null = null;
  private holdElapsed = 0;
  /** Index into the candidate list when the selector is open. */
  private selection = 0;
  private selectorOpen = false;

  register(interactable: Interactable): void {
    this.sources.set(interactable.id, interactable);
  }

  unregister(id: string): void {
    this.sources.delete(id);
    if (this.holdingId === id) this.abortHold();
  }

  clear(): void {
    this.abortHold();
    this.sources.clear();
  }

  get size(): number {
    return this.sources.size;
  }

  get isSelectorOpen(): boolean {
    return this.selectorOpen;
  }

  /** Cycle the selector. No-op when it is not open. */
  cycleSelection(delta: number): void {
    if (!this.selectorOpen) return;
    this.selection += delta;
  }

  openSelector(): void {
    this.selectorOpen = true;
    this.selection = 0;
  }

  closeSelector(): void {
    this.selectorOpen = false;
    this.selection = 0;
  }

  /**
   * Everything offerable right now, best first.
   *
   * Filtered by distance, then facing, then the action's own availability —
   * in that order, cheapest test first. An action that fails any of them is
   * not a candidate, so it can never reach a prompt.
   */
  candidates(query: InteractionQuery, ctx: InteractionContext): Candidate[] {
    if (ctx.busy) return [];

    const out: Candidate[] = [];
    for (const source of this.sources.values()) {
      const p = source.position();
      const dx = p.x - query.position.x;
      const dz = p.z - query.position.z;
      const distance = Math.hypot(dx, dz);

      for (const action of source.actions) {
        if (distance > action.maxDistance) continue;

        if (action.facingTolerance !== null) {
          // Degenerate when standing exactly on it; treat that as facing it.
          if (distance > 1e-3) {
            const toward = Math.atan2(dx, dz);
            if (Math.abs(angleDelta(toward, query.facing)) > action.facingTolerance) continue;
          }
        }

        if (!action.isAvailable(ctx)) continue;
        out.push({ interactable: source, action, distance });
      }
    }

    out.sort((a, b) => {
      if (a.action.priority !== b.action.priority) return b.action.priority - a.action.priority;
      if (a.distance !== b.distance) return a.distance - b.distance;
      return a.action.id < b.action.id ? -1 : a.action.id > b.action.id ? 1 : 0;
    });
    return out;
  }

  /**
   * Advance one frame.
   *
   * Returns the state to render. When a press or a completed hold fires,
   * `onFire` is called with the chosen candidate — returned through a callback
   * rather than in the state so the caller cannot accidentally run it twice by
   * reading the state again.
   */
  update(
    dt: number,
    query: InteractionQuery,
    ctx: InteractionContext,
    onFire: (c: Candidate) => void,
  ): InteractionState {
    const candidates = this.candidates(query, ctx);

    if (candidates.length === 0) {
      this.abortHold();
      if (this.selectorOpen) this.closeSelector();
      return EMPTY;
    }

    // Distinct interactables, not actions: one object offering three things is
    // not ambiguous, two objects each offering one is.
    const distinctSources = new Set(candidates.map((c) => c.interactable.id)).size;
    const needsSelector = distinctSources > 1;
    if (!needsSelector && this.selectorOpen) this.closeSelector();

    const chosen = this.selectorOpen
      ? candidates[((this.selection % candidates.length) + candidates.length) % candidates.length]
      : candidates[0];

    // A hold that drifted onto a different target is a cancel, not a transfer.
    if (this.holdingId !== null && this.holdingId !== chosen.action.id) this.abortHold();

    let fired = false;
    if (query.held) {
      if (chosen.action.holdSeconds <= 0) {
        // Press: fire on the leading edge only.
        if (this.holdingId !== chosen.action.id) {
          this.holdingId = chosen.action.id;
          this.holdElapsed = 0;
          fired = true;
        }
      } else {
        this.holdingId = chosen.action.id;
        this.holdElapsed += dt;
        if (this.holdElapsed >= chosen.action.holdSeconds) {
          fired = true;
          this.holdElapsed = 0;
          this.holdingId = null;
        }
      }
    } else if (this.holdingId !== null) {
      this.abortHold();
    }

    const holdProgress =
      chosen.action.holdSeconds > 0 && this.holdingId === chosen.action.id
        ? Math.min(1, this.holdElapsed / chosen.action.holdSeconds)
        : 0;

    if (fired) onFire(chosen);

    return {
      primary: chosen,
      candidates,
      needsSelector,
      holdProgress,
      // Built from `chosen`, which by construction passed every check.
      prompt: chosen.action.label,
    };
  }

  private abortHold(): void {
    if (this.holdingId === null) return;
    for (const source of this.sources.values()) {
      const action = source.actions.find((a) => a.id === this.holdingId);
      if (action?.cancel) action.cancel();
    }
    this.holdingId = null;
    this.holdElapsed = 0;
  }
}
