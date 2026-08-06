/**
 * The village's fixed interactables, as typed actions.
 *
 * `World` describes a door or a bed as `{ position, radius, kind, prompt }` and
 * `Game` used to turn that into behaviour with a `switch` on `kind`. This is the
 * adapter that retires the switch without rewriting the world: the same data
 * comes out the far side as `InteractionAction`s that declare their own reach,
 * facing and availability.
 *
 * Keeping it an adapter rather than changing `World.Interactable` matters —
 * `CityRuntime` builds that shape too, and both keep working untouched.
 */

import type { Interactable as WorldInteractable } from '../world/World';
import type { Interactable, InteractionAction, InteractionContext } from './InteractionSystem';

/** What the village's actions read beyond the common context. */
export interface WorldInteractionContext extends InteractionContext {
  readonly indoors: boolean;
  readonly sitting: boolean;
}

/** What `Game` does when one of these fires. */
export interface WorldActionHandlers {
  sleep(): void;
  enter(): void;
  exit(): void;
  sit(on: boolean): void;
  wardrobe(): void;
}

/**
 * A generous cone: wide enough that walking up to a bed from the side still
 * offers it, tight enough that the wardrobe behind you does not interrupt.
 */
export const FACING_CONE = (110 * Math.PI) / 180;

const as = (ctx: InteractionContext): WorldInteractionContext => ctx as WorldInteractionContext;

/**
 * Indoor and outdoor interactables can share an x/z footprint — the interior
 * cell sits some 600 m above the village it belongs to. Range is measured
 * horizontally, so what keeps the two apart has to be an explicit gate. Reading
 * the height difference instead would work right up until the cell moves.
 */
const inside = (want: boolean) => (ctx: InteractionContext): boolean =>
  as(ctx).indoors === want && !as(ctx).sitting;

interface KindSpec {
  readonly priority: number;
  /** null means approach from any side. */
  readonly facingTolerance: number | null;
  readonly holdSeconds: number;
  isAvailable(ctx: InteractionContext): boolean;
  run(h: WorldActionHandlers): void;
}

const KINDS: Record<WorldInteractable['kind'], KindSpec> = {
  // A door you cannot use from behind is a door that stands people outside
  // their own house, so the thresholds ignore facing entirely.
  enter: {
    priority: 10, facingTolerance: null, holdSeconds: 0,
    isAvailable: inside(false), run: (h) => h.enter(),
  },
  exit: {
    priority: 10, facingTolerance: null, holdSeconds: 0,
    isAvailable: inside(true), run: (h) => h.exit(),
  },
  // Sleeping outranks the rest: standing at the foot of the bed with the
  // wardrobe in reach, the bed is what you meant.
  sleep: {
    priority: 30, facingTolerance: FACING_CONE, holdSeconds: 0,
    isAvailable: inside(true), run: (h) => h.sleep(),
  },
  sit: {
    priority: 20, facingTolerance: FACING_CONE, holdSeconds: 0,
    isAvailable: inside(true), run: (h) => h.sit(true),
  },
  wardrobe: {
    priority: 20, facingTolerance: FACING_CONE, holdSeconds: 0,
    isAvailable: inside(true), run: (h) => h.wardrobe(),
  },
};

/**
 * Standing up, offered by the chair while seated.
 *
 * A second action on the same interactable rather than a mutable label, because
 * a label is fixed at construction and "sit" and "stand" are genuinely two
 * different things with two different availabilities. It reaches further than
 * the seat's own radius: seated, the camera has pulled back and the only thing
 * that must never become unreachable is the way out of the chair.
 */
function standAction(h: WorldActionHandlers): InteractionAction {
  return {
    id: 'stand',
    label: 'Stand up',
    priority: 100,
    maxDistance: 4,
    facingTolerance: null,
    holdSeconds: 0,
    isAvailable: (ctx) => as(ctx).sitting,
    execute: () => h.sit(false),
  };
}

/**
 * Wrap the world's interactables.
 *
 * Ids are positional, so they are stable for a given zone build and change when
 * the zone does — which is exactly when the registrations are rebuilt anyway.
 */
export function worldInteractables(
  list: readonly WorldInteractable[],
  handlers: WorldActionHandlers,
): Interactable[] {
  return list.map((it, i) => {
    const spec = KINDS[it.kind];
    const id = `${it.kind}-${i}`;
    const actions: InteractionAction[] = [
      {
        id: `${id}:${it.kind}`,
        label: it.prompt,
        priority: spec.priority,
        maxDistance: it.radius,
        facingTolerance: spec.facingTolerance,
        holdSeconds: spec.holdSeconds,
        isAvailable: spec.isAvailable,
        execute: () => spec.run(handlers),
      },
    ];
    if (it.kind === 'sit') actions.push(standAction(handlers));

    // Cloned so a later mutation of the world's vector cannot move a
    // registration out from under the system; `position()` is read per frame,
    // which is what a vehicle will need in Phase 5.
    const at = it.position.clone();
    return { id, position: () => at, actions };
  });
}
