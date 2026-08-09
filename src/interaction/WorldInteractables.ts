/**
 * The world's fixed interactables, as typed actions.
 *
 * Two adapters, because there are now two sources. Outdoors, `World` supplies
 * doors; indoors, whichever interior is open supplies its own points. Before
 * Phase 7 both came from the same list — the shared room was built by `World`
 * and its bed, chair and wardrobe were entries every zone inherited whether
 * or not it had them.
 *
 * Keeping these as adapters rather than changing the producers matters:
 * `CityRuntime` builds `Interactable`s too, and both keep working untouched.
 */

import type { Interactable as WorldInteractable } from '../world/World';
import type { BuiltPoint } from '../world/interiors/InteriorBuilder';
import type { Interactable, InteractionAction, InteractionContext } from './InteractionSystem';

/** What the actions read beyond the common context. */
export interface WorldInteractionContext extends InteractionContext {
  readonly indoors: boolean;
  readonly sitting: boolean;
}

/** What `Game` does when one of these fires. */
export interface WorldActionHandlers {
  /** Open the door with this id. */
  enter(doorId: string): void;
  exit(): void;
  sit(on: boolean): void;
  sleep(): void;
  wardrobe(): void;
  shower(): void;
  /** Open a service menu, or run its single offer. */
  service(serviceId: string, pointId: string): void;
  /** Sign up for a job from an interaction point. */
  task(taskId: string, pointId: string): void;
  /** A point with no service and no task — the host decides from its kind. */
  point(pointId: string, kind: BuiltPoint['kind']): void;
}

/**
 * A generous cone: wide enough that walking up to a bed from the side still
 * offers it, tight enough that the wardrobe behind you does not interrupt.
 */
export const FACING_CONE = (110 * Math.PI) / 180;

const as = (ctx: InteractionContext): WorldInteractionContext => ctx as WorldInteractionContext;

/**
 * Indoor and outdoor interactables can share an x/z footprint — an interior
 * cell sits some 600 m above the village it belongs to. Range is measured
 * horizontally, so what keeps the two apart has to be an explicit gate.
 * Reading the height difference instead would work right up until a cell
 * moves, and Phase 7 moves eight of them.
 */
const inside = (want: boolean) => (ctx: InteractionContext): boolean =>
  as(ctx).indoors === want && !as(ctx).sitting;

/**
 * Standing up, offered by any seat while seated.
 *
 * A second action on the same interactable rather than a mutable label,
 * because a label is fixed at construction and "sit" and "stand" are genuinely
 * two different things with two different availabilities. It reaches further
 * than the seat's own radius: seated, the camera has pulled back and the one
 * thing that must never become unreachable is the way out of the chair.
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
 * Doors, from the active zone.
 *
 * Ids are the door's own, so they survive a rebuild in a way the old
 * positional `enter-3` did not — and they are what a save records when the
 * player is inside.
 */
export function worldInteractables(
  list: readonly WorldInteractable[],
  handlers: WorldActionHandlers,
): Interactable[] {
  return list.map((it) => {
    // Cloned so a later mutation of the world's vector cannot move a
    // registration out from under the system.
    const at = it.position.clone();
    return {
      id: `door:${it.doorId}`,
      position: () => at,
      actions: [
        {
          id: `door:${it.doorId}:enter`,
          label: it.prompt,
          // A door you cannot use from behind is a door that stands people
          // outside their own house, so the threshold ignores facing.
          priority: 30,
          maxDistance: it.radius,
          facingTolerance: null,
          holdSeconds: 0,
          isAvailable: inside(false),
          execute: () => handlers.enter(it.doorId),
        },
      ],
    };
  });
}

/** Priority per point kind. Sleeping outranks the furniture beside it. */
const POINT_PRIORITY: Readonly<Record<BuiltPoint['kind'], number>> = {
  bed: 30,
  counter: 25,
  desk: 22,
  shelf: 20,
  chair: 20,
  wardrobe: 20,
  shower: 20,
  lift: 20,
  rack: 20,
  cell: 15,
  decorate: 20,
  save: 22,
  fish: 20,
};

/** Kinds where facing matters. A bed does not care; a shop counter does. */
const NEEDS_FACING: ReadonlySet<BuiltPoint['kind']> = new Set<BuiltPoint['kind']>([
  'counter',
  'desk',
  'shelf',
  'wardrobe',
  'rack',
  'save',
]);

/**
 * The open interior's own points, plus the way out.
 *
 * The exit is registered here rather than as a point in the catalogue because
 * every interior has one and none of them should have to say so. It is also
 * the reason `Game` keeps its "interact with nothing in reach means let me
 * out" fallback: gating the way out on a proximity radius is how you strand
 * somebody in a room.
 */
export function interiorInteractables(
  points: readonly BuiltPoint[],
  exit: { x: number; y: number; z: number },
  handlers: WorldActionHandlers,
): Interactable[] {
  const out: Interactable[] = [
    {
      id: 'interior:exit',
      position: () => exit,
      actions: [
        {
          id: 'interior:exit:leave',
          label: 'Step back outside',
          priority: 10,
          maxDistance: 5.4,
          facingTolerance: null,
          holdSeconds: 0,
          isAvailable: inside(true),
          execute: () => handlers.exit(),
        },
      ],
    },
  ];

  for (const p of points) {
    const at = p.world;
    const actions: InteractionAction[] = [
      {
        id: `point:${p.id}`,
        label: p.prompt,
        priority: p.priority ?? POINT_PRIORITY[p.kind],
        maxDistance: p.radius,
        facingTolerance: NEEDS_FACING.has(p.kind) ? FACING_CONE : null,
        holdSeconds: 0,
        isAvailable: inside(true),
        execute: () => {
          // Order matters: a point can name both, and signing up for a shift
          // is what the grocery's back counter is *for*.
          if (p.task) handlers.task(p.task, p.id);
          else if (p.service) handlers.service(p.service, p.id);
          else handlers.point(p.id, p.kind);
        },
      },
    ];
    if (p.kind === 'chair') actions.push(standAction(handlers));
    out.push({ id: `point:${p.id}`, position: () => at, actions });
  }

  return out;
}
