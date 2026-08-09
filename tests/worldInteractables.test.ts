import { describe, it, expect, vi } from 'vitest';
import * as THREE from 'three';
import type { Interactable as WorldInteractable } from '../src/world/World';
import type { BuiltPoint } from '../src/world/interiors/InteriorBuilder';
import { InteractionSystem, type InteractionQuery } from '../src/interaction/InteractionSystem';
import {
  FACING_CONE,
  interiorInteractables,
  worldInteractables,
  type WorldActionHandlers,
  type WorldInteractionContext,
} from '../src/interaction/WorldInteractables';

/**
 * Phase 7 split this into two adapters: doors come from the active zone,
 * everything else from whichever interior is open. The separation tests below
 * survive that split unchanged — an interior cell still sits hundreds of
 * metres above the village and range is still horizontal, so the explicit
 * indoors gate is still the only thing keeping the two apart.
 */

function handlers(): WorldActionHandlers & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    sleep: () => calls.push('sleep'),
    enter: (id) => calls.push(`enter:${id}`),
    exit: () => calls.push('exit'),
    sit: (on: boolean) => calls.push(on ? 'sit' : 'stand'),
    wardrobe: () => calls.push('wardrobe'),
    shower: () => calls.push('shower'),
    service: (s, p) => calls.push(`service:${s}:${p}`),
    task: (t) => calls.push(`task:${t}`),
    point: (id, kind) => calls.push(`point:${id}:${kind}`),
  };
}

const door = (x: number, z: number, radius = 2.5): WorldInteractable => ({
  position: new THREE.Vector3(x, 0, z),
  radius,
  kind: 'enter',
  prompt: 'Go inside',
  doorId: `d${x}_${z}`,
  service: 'home',
});

const point = (
  id: string,
  kind: BuiltPoint['kind'],
  x: number,
  z: number,
  extra: Partial<BuiltPoint> = {},
): BuiltPoint => ({
  id,
  kind,
  x,
  y: 1,
  z,
  radius: 2.5,
  prompt: `Use ${kind}`,
  world: new THREE.Vector3(x, 1, z),
  ...extra,
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

function systemFor(
  doors: WorldInteractable[],
  points: BuiltPoint[],
  h: WorldActionHandlers,
  exit = { x: 0, y: 1, z: 1 },
): InteractionSystem {
  const s = new InteractionSystem();
  for (const it of worldInteractables(doors, h)) s.register(it);
  if (points.length > 0 || exit) {
    for (const it of interiorInteractables(points, exit, h)) s.register(it);
  }
  return s;
}

describe('indoor and outdoor separation', () => {
  it('offers the front door only from outside', () => {
    const h = handlers();
    const s = systemFor([door(0, 1)], [], h);
    const out = s.candidates(query(), ctx({ indoors: false })).map((c) => c.interactable.id);
    expect(out).toEqual(['door:d0_1']);
  });

  it('offers the way out only from inside', () => {
    const h = handlers();
    const s = systemFor([door(0, 1)], [], h);
    const inside = s.candidates(query(), ctx({ indoors: true })).map((c) => c.interactable.id);
    expect(inside).toEqual(['interior:exit']);
  });

  it('routes a point to the handler its data names', () => {
    const h = handlers();
    const s = systemFor(
      [],
      [
        point('p_shop', 'counter', 0, 1, { service: 'grocery_buy' }),
        point('p_job', 'desk', 0.4, 1, { task: 'job_grocery_shift' }),
        point('p_bed', 'bed', 8, 0),
      ],
      h,
    );
    for (const c of s.candidates(query(), ctx({ indoors: true }))) {
      c.action.execute(ctx({ indoors: true }));
    }
    expect(h.calls).toContain('service:grocery_buy:p_shop');
    expect(h.calls).toContain('task:job_grocery_shift');
  });

  it('prefers a task over a service when a point declares both', () => {
    // Signing up for a shift is what the grocery's back counter is for.
    const h = handlers();
    const s = systemFor(
      [],
      [point('p', 'desk', 0, 1, { service: 'grocery_buy', task: 'job_grocery_shift' })],
      h,
      { x: 40, y: 1, z: 40 },
    );
    s.candidates(query(), ctx({ indoors: true }))[0].action.execute(ctx({ indoors: true }));
    expect(h.calls).toEqual(['task:job_grocery_shift']);
  });

  it('falls back to the point handler when it names neither', () => {
    const h = handlers();
    const s = systemFor([], [point('p_bed', 'bed', 0, 1)], h, { x: 40, y: 1, z: 40 });
    s.candidates(query(), ctx({ indoors: true }))[0].action.execute(ctx({ indoors: true }));
    expect(h.calls).toEqual(['point:p_bed:bed']);
  });
});

describe('facing', () => {
  it('offers a door approached from behind, because the alternative strands you', () => {
    const h = handlers();
    const s = systemFor([door(0, 2)], [], h, { x: 40, y: 1, z: 40 });
    const c = s.candidates(query({ facing: Math.PI }), ctx());
    expect(c).toHaveLength(1);
  });

  it('does not offer a counter that is behind the player', () => {
    const h = handlers();
    const s = systemFor([], [point('c', 'counter', 0, 2)], h, { x: 40, y: 1, z: 40 });
    expect(s.candidates(query({ facing: Math.PI }), ctx({ indoors: true }))).toHaveLength(0);
  });

  it('offers a counter approached from the side, within the cone', () => {
    const h = handlers();
    const s = systemFor([], [point('c', 'counter', 0, 2)], h, { x: 40, y: 1, z: 40 });
    const justInside = FACING_CONE - 0.05;
    expect(s.candidates(query({ facing: justInside }), ctx({ indoors: true }))).toHaveLength(1);
  });

  it('ignores facing for a bed, which you can climb into from either side', () => {
    const h = handlers();
    const s = systemFor([], [point('b', 'bed', 0, 2)], h, { x: 40, y: 1, z: 40 });
    expect(s.candidates(query({ facing: Math.PI }), ctx({ indoors: true }))).toHaveLength(1);
  });
});

describe('priority', () => {
  it('picks the bed over the wardrobe when both are in reach', () => {
    const h = handlers();
    // Wardrobe nearer, bed further -- priority has to beat distance here, or
    // standing at the foot of the bed offers you a change of clothes.
    const s = systemFor(
      [],
      [point('b', 'bed', 0, 2), point('w', 'wardrobe', 0, 1)],
      h,
      { x: 40, y: 1, z: 40 },
    );
    expect(s.candidates(query(), ctx({ indoors: true }))[0].interactable.id).toBe('point:b');
  });

  it('puts the way out below everything else in the room', () => {
    // The exit is the fallback, not the first offer -- pressing interact at a
    // counter by the door should serve you, not throw you into the street.
    const h = handlers();
    const s = systemFor([], [point('c', 'counter', 0, 1)], h, { x: 0, y: 1, z: 1 });
    expect(s.candidates(query(), ctx({ indoors: true }))[0].interactable.id).toBe('point:c');
  });

  it('honours a point that overrides its kind priority', () => {
    const h = handlers();
    const s = systemFor(
      [],
      [point('low', 'counter', 0, 1), point('high', 'shelf', 0, 1.1, { priority: 99 })],
      h,
      { x: 40, y: 1, z: 40 },
    );
    expect(s.candidates(query(), ctx({ indoors: true }))[0].interactable.id).toBe('point:high');
  });
});

describe('sitting', () => {
  const seats = [point('seat', 'chair', 0, 1), point('bed', 'bed', 0, 1.2)];

  it('offers only standing up once seated', () => {
    const h = handlers();
    const s = systemFor([], seats, h);
    const c = s.candidates(query(), ctx({ indoors: true, sitting: true }));
    expect(c.map((x) => x.action.id)).toEqual(['stand']);
  });

  it('offers the chair, not standing, when on foot', () => {
    const h = handlers();
    const s = systemFor([], seats, h);
    const ids = s.candidates(query(), ctx({ indoors: true })).map((x) => x.action.id);
    expect(ids).not.toContain('stand');
    expect(ids).toContain('point:seat');
  });

  it('reaches the chair from further than the seat radius', () => {
    // Seated, the camera pulls back. The way out of the chair must not be the
    // thing that goes out of range.
    const h = handlers();
    const s = systemFor(
      [],
      [{ ...point('seat', 'chair', 0, 3.5), radius: 1.0 }],
      h,
      { x: 40, y: 1, z: 40 },
    );
    const c = s.candidates(query(), ctx({ indoors: true, sitting: true }));
    expect(c.map((x) => x.action.id)).toEqual(['stand']);
    c[0].action.execute(ctx({ indoors: true, sitting: true }));
    expect(h.calls).toEqual(['stand']);
  });

  it('gives standing up to a chair and to nothing else', () => {
    const h = handlers();
    const s = systemFor([], [point('b', 'bed', 0, 1)], h, { x: 40, y: 1, z: 40 });
    expect(s.candidates(query(), ctx({ indoors: true, sitting: true }))).toHaveLength(0);
  });
});

describe('driving it a frame at a time', () => {
  it('fires once per press, not once per frame held', () => {
    const h = handlers();
    const s = systemFor([door(0, 1)], [], h, { x: 40, y: 1, z: 40 });
    const fire = vi.fn((c: { action: { execute: (x: WorldInteractionContext) => void } }) =>
      c.action.execute(ctx()),
    );

    for (let i = 0; i < 10; i++) s.update(0.016, query({ held: true }), ctx(), fire);
    expect(h.calls).toEqual(['enter:d0_1']);
  });

  it('offers nothing while the game is busy', () => {
    const h = handlers();
    const s = systemFor([door(0, 1)], [], h, { x: 40, y: 1, z: 40 });
    const state = s.update(0.016, query({ held: true }), ctx({ busy: true }), () => {});
    expect(state.prompt).toBeNull();
    expect(h.calls).toEqual([]);
  });

  it('shows the prompt the world authored', () => {
    const h = handlers();
    const s = systemFor([door(0, 1)], [], h, { x: 40, y: 1, z: 40 });
    expect(s.update(0.016, query(), ctx(), () => {}).prompt).toBe('Go inside');
  });

  it('asks for a selector when two things in the room both offer something', () => {
    const h = handlers();
    const s = systemFor(
      [],
      [point('a', 'bed', 0, 1), point('b', 'wardrobe', 0.5, 1)],
      h,
      { x: 40, y: 1, z: 40 },
    );
    expect(s.update(0.016, query(), ctx({ indoors: true }), () => {}).needsSelector).toBe(true);
  });

  it('does not ask for a selector for one object offering two things', () => {
    const h = handlers();
    const s = systemFor([], [point('seat', 'chair', 0, 1)], h, { x: 40, y: 1, z: 40 });
    expect(s.update(0.016, query(), ctx({ indoors: true }), () => {}).needsSelector).toBe(false);
  });

  it('carries the door id through to the handler', () => {
    // The id is what a save records when the player is inside, so it has to
    // survive the trip from World through the adapter to Game intact.
    const h = handlers();
    const s = systemFor([door(3, 1)], [], h, { x: 40, y: 1, z: 40 });
    s.candidates(query({ position: { x: 3, y: 1.4, z: 0 } }), ctx())[0].action.execute(ctx());
    expect(h.calls).toEqual(['enter:d3_1']);
  });
});
