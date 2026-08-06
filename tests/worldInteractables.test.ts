import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { Interactable as WorldInteractable } from '../src/world/World';
import { InteractionSystem, type InteractionQuery } from '../src/interaction/InteractionSystem';
import {
  worldInteractables,
  FACING_CONE,
  type WorldActionHandlers,
  type WorldInteractionContext,
} from '../src/interaction/WorldInteractables';

function handlers(): WorldActionHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sleep: () => calls.push('sleep'),
    enter: () => calls.push('enter'),
    exit: () => calls.push('exit'),
    sit: (on: boolean) => calls.push(on ? 'sit' : 'stand'),
    wardrobe: () => calls.push('wardrobe'),
  };
}

const at = (
  kind: WorldInteractable['kind'],
  x: number,
  z: number,
  radius = 2.5,
): WorldInteractable => ({
  position: new THREE.Vector3(x, 0, z),
  radius,
  kind,
  prompt: `Use ${kind}`,
});

function ctx(patch: Partial<WorldInteractionContext> = {}): WorldInteractionContext {
  return { age: 18, busy: false, indoors: false, sitting: false, ...patch };
}

/** Player at the origin, looking down +Z. */
const query = (patch: Partial<InteractionQuery> = {}): InteractionQuery => ({
  position: { x: 0, y: 1.4, z: 0 },
  facing: 0,
  held: false,
  ...patch,
});

function systemFor(list: WorldInteractable[], h: WorldActionHandlers): InteractionSystem {
  const s = new InteractionSystem();
  for (const it of worldInteractables(list, h)) s.register(it);
  return s;
}

describe('indoor and outdoor separation', () => {
  // The interior cell sits ~600 m above the village, so the two can share an
  // x/z footprint. Range is horizontal, so only an explicit gate keeps them
  // apart -- reading the height difference would break when the cell moves.
  const both = [at('enter', 0, 1), at('exit', 0, 1)];

  it('offers the front door only from outside', () => {
    const h = handlers();
    const s = systemFor(both, h);
    const out = s.candidates(query(), ctx({ indoors: false })).map((c) => c.interactable.id);
    expect(out).toEqual(['enter-0']);
  });

  it('offers the way out only from inside', () => {
    const h = handlers();
    const s = systemFor(both, h);
    const inside = s.candidates(query(), ctx({ indoors: true })).map((c) => c.interactable.id);
    expect(inside).toEqual(['exit-1']);
  });

  it('routes each kind to its handler', () => {
    const h = handlers();
    const s = systemFor([at('sleep', 0, 1), at('wardrobe', 8, 0)], h);
    const c = s.candidates(query(), ctx({ indoors: true }));
    for (const it of c) it.action.execute(ctx({ indoors: true }));
    expect(h.calls).toEqual(['sleep']);
  });
});

describe('facing', () => {
  it('offers a door approached from behind, because the alternative strands you', () => {
    const h = handlers();
    const s = systemFor([at('enter', 0, 2)], h);
    // Facing away from the door entirely.
    const c = s.candidates(query({ facing: Math.PI }), ctx());
    expect(c).toHaveLength(1);
  });

  it('does not offer a bed that is behind the player', () => {
    const h = handlers();
    const s = systemFor([at('sleep', 0, 2)], h);
    expect(s.candidates(query({ facing: Math.PI }), ctx({ indoors: true }))).toHaveLength(0);
  });

  it('offers a bed approached from the side, within the cone', () => {
    const h = handlers();
    const s = systemFor([at('sleep', 0, 2)], h);
    const justInside = FACING_CONE - 0.05;
    expect(s.candidates(query({ facing: justInside }), ctx({ indoors: true }))).toHaveLength(1);
  });
});

describe('priority', () => {
  it('picks the bed over the wardrobe when both are in reach', () => {
    const h = handlers();
    // Wardrobe nearer, bed further -- priority has to beat distance here, or
    // standing at the foot of the bed offers you a change of clothes.
    const s = systemFor([at('sleep', 0, 2), at('wardrobe', 0, 1)], h);
    const c = s.candidates(query(), ctx({ indoors: true }));
    expect(c[0].interactable.id).toBe('sleep-0');
  });
});

describe('sitting', () => {
  const room = [at('sit', 0, 1), at('sleep', 0, 1.2), at('exit', 0, 1)];

  it('offers only standing up once seated', () => {
    const h = handlers();
    const s = systemFor(room, h);
    const c = s.candidates(query(), ctx({ indoors: true, sitting: true }));
    expect(c.map((x) => x.action.id)).toEqual(['stand']);
  });

  it('offers the chair, not standing, when on foot', () => {
    const h = handlers();
    const s = systemFor(room, h);
    const ids = s.candidates(query(), ctx({ indoors: true })).map((x) => x.action.id);
    expect(ids).not.toContain('stand');
    expect(ids.some((i) => i.endsWith(':sit'))).toBe(true);
  });

  it('reaches the chair from further than the seat radius', () => {
    // Seated, the camera pulls back. The way out of the chair must not be the
    // thing that goes out of range.
    const h = handlers();
    const s = systemFor([at('sit', 0, 3.5, 1.0)], h);
    const c = s.candidates(query(), ctx({ indoors: true, sitting: true }));
    expect(c.map((x) => x.action.id)).toEqual(['stand']);
    c[0].action.execute(ctx({ indoors: true, sitting: true }));
    expect(h.calls).toEqual(['stand']);
  });
});

describe('driving it a frame at a time', () => {
  it('fires once per press, not once per frame held', () => {
    const h = handlers();
    const s = systemFor([at('enter', 0, 1)], h);
    const fire = vi.fn((c: { action: { execute: (x: WorldInteractionContext) => void } }) =>
      c.action.execute(ctx()),
    );

    for (let i = 0; i < 10; i++) s.update(0.016, query({ held: true }), ctx(), fire);
    expect(h.calls).toEqual(['enter']);
  });

  it('offers nothing while the game is busy', () => {
    const h = handlers();
    const s = systemFor([at('enter', 0, 1)], h);
    const state = s.update(0.016, query({ held: true }), ctx({ busy: true }), () => {});
    expect(state.prompt).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it('shows the prompt the world authored', () => {
    const h = handlers();
    const s = systemFor([at('enter', 0, 1)], h);
    const state = s.update(0.016, query(), ctx(), () => {});
    expect(state.prompt).toBe('Use enter');
  });

  it('asks for a selector when a door and a bed both offer something', () => {
    const h = handlers();
    const s = systemFor([at('exit', 0, 1), at('sleep', 0.5, 1)], h);
    const state = s.update(0.016, query(), ctx({ indoors: true }), () => {});
    expect(state.needsSelector).toBe(true);
  });

  it('does not ask for a selector for one object offering two things', () => {
    const h = handlers();
    const s = systemFor([at('sit', 0, 1)], h);
    // Seated, the chair offers stand; on foot it offers sit. Never both, but
    // even if it did, one object is not a choice.
    const state = s.update(0.016, query(), ctx({ indoors: true }), () => {});
    expect(state.needsSelector).toBe(false);
  });
});
