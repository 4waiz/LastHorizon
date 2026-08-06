import { describe, it, expect, vi } from 'vitest';
import {
  InteractionSystem,
  angleDelta,
  type Candidate,
  type Interactable,
  type InteractionAction,
  type InteractionContext,
} from '../src/interaction/InteractionSystem';

const ctx = (over: Partial<InteractionContext> = {}): InteractionContext => ({
  age: 18,
  busy: false,
  ...over,
});

function action(over: Partial<InteractionAction> = {}): InteractionAction {
  return {
    id: 'act',
    label: 'Do the thing',
    priority: 0,
    maxDistance: 2,
    facingTolerance: null,
    holdSeconds: 0,
    isAvailable: () => true,
    execute: () => {},
    ...over,
  };
}

function thing(id: string, x: number, z: number, actions: InteractionAction[]): Interactable {
  return { id, position: () => ({ x, y: 0, z }), actions };
}

const at = (x: number, z: number, facing = 0, held = false) => ({
  position: { x, y: 0, z },
  facing,
  held,
});

describe('candidate filtering', () => {
  it('offers nothing when out of range', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 10, [action({ maxDistance: 2 })]));
    expect(s.candidates(at(0, 0), ctx())).toEqual([]);
  });

  it('offers what is in range', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 1, [action()]));
    expect(s.candidates(at(0, 0), ctx())).toHaveLength(1);
  });

  it('offers nothing at all while the game is busy', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 1, [action()]));
    expect(s.candidates(at(0, 0), ctx({ busy: true }))).toEqual([]);
  });

  it('respects a facing requirement', () => {
    const s = new InteractionSystem();
    // Counter is at +Z; facing 0 looks along +Z.
    s.register(thing('counter', 0, 1.5, [action({ facingTolerance: 0.6 })]));
    expect(s.candidates(at(0, 0, 0), ctx())).toHaveLength(1);
    // Turned around.
    expect(s.candidates(at(0, 0, Math.PI), ctx())).toEqual([]);
  });

  it('ignores facing when the action does not care', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 1.5, [action({ facingTolerance: null })]));
    expect(s.candidates(at(0, 0, Math.PI), ctx())).toHaveLength(1);
  });

  it('treats standing exactly on it as facing it', () => {
    const s = new InteractionSystem();
    s.register(thing('mark', 0, 0, [action({ facingTolerance: 0.2 })]));
    expect(s.candidates(at(0, 0, 2.5), ctx())).toHaveLength(1);
  });
});

describe('criterion 3 — a prompt never claims an unavailable action', () => {
  it('does not offer an action whose availability is false', () => {
    const s = new InteractionSystem();
    s.register(thing('shop', 0, 1, [action({ label: 'Buy bread', isAvailable: () => false })]));
    const state = s.update(0.016, at(0, 0), ctx(), () => {});
    expect(state.prompt).toBeNull();
    expect(state.primary).toBeNull();
  });

  it('falls through to a different action that is available', () => {
    const s = new InteractionSystem();
    s.register(
      thing('shop', 0, 1, [
        action({ id: 'buy', label: 'Buy bread', priority: 10, isAvailable: () => false }),
        action({ id: 'talk', label: 'Talk to the shopkeeper', priority: 1 }),
      ]),
    );
    const state = s.update(0.016, at(0, 0), ctx(), () => {});
    expect(state.prompt).toBe('Talk to the shopkeeper');
  });

  it('re-evaluates availability every frame', () => {
    const s = new InteractionSystem();
    let stocked = true;
    s.register(thing('shop', 0, 1, [action({ label: 'Buy bread', isAvailable: () => stocked })]));
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('Buy bread');
    stocked = false;
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBeNull();
  });

  it('passes context to availability, so age gates work', () => {
    const s = new InteractionSystem();
    s.register(
      thing('rack', 0, 1, [
        action({ label: 'Buy a shotgun', isAvailable: (c) => c.age >= 18 }),
      ]),
    );
    expect(s.update(0.016, at(0, 0), ctx({ age: 16 }), () => {}).prompt).toBeNull();
    expect(s.update(0.016, at(0, 0), ctx({ age: 18 }), () => {}).prompt).toBe('Buy a shotgun');
  });
});

describe('priority and ordering', () => {
  it('prefers higher priority over nearer', () => {
    const s = new InteractionSystem();
    s.register(thing('near', 0, 0.5, [action({ id: 'low', label: 'Low', priority: 1 })]));
    s.register(thing('far', 0, 1.8, [action({ id: 'high', label: 'High', priority: 9 })]));
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('High');
  });

  it('breaks a priority tie on distance', () => {
    const s = new InteractionSystem();
    s.register(thing('far', 0, 1.8, [action({ id: 'a', label: 'Far' })]));
    s.register(thing('near', 0, 0.4, [action({ id: 'b', label: 'Near' })]));
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('Near');
  });

  it('is deterministic when priority and distance both tie', () => {
    const s = new InteractionSystem();
    s.register(thing('one', 0, 1, [action({ id: 'zebra', label: 'Z' })]));
    s.register(thing('two', 0, 1, [action({ id: 'apple', label: 'A' })]));
    const a = s.update(0.016, at(0, 0), ctx(), () => {}).prompt;
    const b = s.update(0.016, at(0, 0), ctx(), () => {}).prompt;
    expect(a).toBe('A');
    expect(b).toBe('A');
  });
});

describe('the selector, for overlapping interactables', () => {
  it('does not ask when one object offers several actions', () => {
    const s = new InteractionSystem();
    s.register(
      thing('car', 0, 1, [
        action({ id: 'drive', label: 'Drive', priority: 2 }),
        action({ id: 'boot', label: 'Open the boot', priority: 1 }),
      ]),
    );
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).needsSelector).toBe(false);
  });

  it('asks when two objects each offer something', () => {
    const s = new InteractionSystem();
    s.register(thing('door', 0, 1, [action({ id: 'enter', label: 'Go inside' })]));
    s.register(thing('bike', 0.5, 1, [action({ id: 'ride', label: 'Ride' })]));
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).needsSelector).toBe(true);
  });

  it('cycles through candidates while open', () => {
    const s = new InteractionSystem();
    s.register(thing('door', 0, 1, [action({ id: 'enter', label: 'Go inside', priority: 2 })]));
    s.register(thing('bike', 0.5, 1, [action({ id: 'ride', label: 'Ride', priority: 1 })]));

    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('Go inside');
    s.openSelector();
    s.cycleSelection(1);
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('Ride');
    s.cycleSelection(1);
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('Go inside');
  });

  it('closes itself when the ambiguity goes away', () => {
    const s = new InteractionSystem();
    s.register(thing('door', 0, 1, [action({ id: 'enter', label: 'Go inside' })]));
    s.register(thing('bike', 0.5, 1, [action({ id: 'ride', label: 'Ride' })]));
    s.update(0.016, at(0, 0), ctx(), () => {});
    s.openSelector();
    s.unregister('bike');
    s.update(0.016, at(0, 0), ctx(), () => {});
    expect(s.isSelectorOpen).toBe(false);
  });
});

describe('press and hold', () => {
  it('fires a press once on the leading edge', () => {
    const s = new InteractionSystem();
    const fire = vi.fn();
    s.register(thing('door', 0, 1, [action({ holdSeconds: 0 })]));

    s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('fires again after the control is released', () => {
    const s = new InteractionSystem();
    const fire = vi.fn();
    s.register(thing('door', 0, 1, [action({ holdSeconds: 0 })]));

    s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    s.update(0.016, at(0, 0, 0, false), ctx(), fire);
    s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    expect(fire).toHaveBeenCalledTimes(2);
  });

  it('only fires a hold once the time has elapsed', () => {
    const s = new InteractionSystem();
    const fire = vi.fn();
    s.register(thing('safe', 0, 1, [action({ holdSeconds: 1 })]));

    for (let i = 0; i < 30; i++) s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    expect(fire).not.toHaveBeenCalled();
    for (let i = 0; i < 40; i++) s.update(0.016, at(0, 0, 0, true), ctx(), fire);
    expect(fire).toHaveBeenCalledTimes(1);
  });

  it('reports hold progress for a radial indicator', () => {
    const s = new InteractionSystem();
    s.register(thing('safe', 0, 1, [action({ holdSeconds: 1 })]));
    let state = s.update(0.25, at(0, 0, 0, true), ctx(), () => {});
    expect(state.holdProgress).toBeCloseTo(0.25, 3);
    state = s.update(0.25, at(0, 0, 0, true), ctx(), () => {});
    expect(state.holdProgress).toBeCloseTo(0.5, 3);
  });

  it('cancels a hold that is released early', () => {
    const cancel = vi.fn();
    const s = new InteractionSystem();
    s.register(thing('safe', 0, 1, [action({ holdSeconds: 1, cancel })]));

    s.update(0.3, at(0, 0, 0, true), ctx(), () => {});
    s.update(0.016, at(0, 0, 0, false), ctx(), () => {});
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels a hold when the player walks out of range', () => {
    const cancel = vi.fn();
    const s = new InteractionSystem();
    s.register(thing('safe', 0, 1, [action({ holdSeconds: 1, maxDistance: 2, cancel })]));

    s.update(0.3, at(0, 0, 0, true), ctx(), () => {});
    s.update(0.016, at(0, 40, 0, true), ctx(), () => {});
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it('cancels rather than transfers when the target changes mid-hold', () => {
    const cancel = vi.fn();
    const s = new InteractionSystem();
    s.register(thing('safe', 0, 1, [action({ id: 'crack', holdSeconds: 1, priority: 1, cancel })]));
    s.update(0.3, at(0, 0, 0, true), ctx(), () => {});

    // A higher-priority action appears and takes over.
    s.register(thing('alarm', 0, 1, [action({ id: 'silence', holdSeconds: 1, priority: 9 })]));
    s.update(0.016, at(0, 0, 0, true), ctx(), () => {});
    expect(cancel).toHaveBeenCalledTimes(1);
  });
});

describe('registration', () => {
  it('unregistering removes the offer', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 1, [action()]));
    expect(s.size).toBe(1);
    s.unregister('bed');
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBeNull();
  });

  it('registering the same id replaces rather than duplicates', () => {
    const s = new InteractionSystem();
    s.register(thing('bed', 0, 1, [action({ label: 'Old' })]));
    s.register(thing('bed', 0, 1, [action({ label: 'New' })]));
    expect(s.size).toBe(1);
    expect(s.update(0.016, at(0, 0), ctx(), () => {}).prompt).toBe('New');
  });
});

describe('angleDelta', () => {
  it('takes the short way round', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2, 6);
    expect(angleDelta(Math.PI - 0.1, -Math.PI + 0.1)).toBeCloseTo(-0.2, 6);
  });
});

describe('execute', () => {
  it('hands the fired candidate back with its action', async () => {
    const s = new InteractionSystem();
    const execute = vi.fn();
    s.register(thing('door', 0, 1, [action({ id: 'enter', execute })]));

    let fired: Candidate | null = null;
    s.update(0.016, at(0, 0, 0, true), ctx(), (c) => (fired = c));
    expect(fired).not.toBeNull();
    await fired!.action.execute(ctx());
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe('one press does one thing', () => {
  /**
   * The village's actions move the player: sitting down, stepping through a
   * door. So the frame after one fires, a *different* action is in range. With
   * the interact button still down, a latch that keyed on the action id let
   * that second one fire too — standing up put the chair back in reach and the
   * next frame sat down again, off a single press.
   */
  it('does not fire a second action that the first one brought into range', () => {
    const s = new InteractionSystem();
    const fired: string[] = [];

    // `stand` is offered while seated, `sit` while not. Firing either flips
    // which is available, exactly as the chair does.
    let seated = true;
    s.register(
      thing('chair', 0, 1, [
        action({ id: 'stand', isAvailable: () => seated, execute: () => { seated = false; } }),
        action({ id: 'sit', isAvailable: () => !seated, execute: () => { seated = true; } }),
      ]),
    );

    const onFire = (c: Candidate) => {
      fired.push(c.action.id);
      c.action.execute(ctx());
    };
    for (let i = 0; i < 10; i++) s.update(1 / 60, at(0, 0, 0, true), ctx(), onFire);

    expect(fired).toEqual(['stand']);
    expect(seated).toBe(false);
  });

  it('fires again only after the control is released', () => {
    const s = new InteractionSystem();
    const fired: string[] = [];
    s.register(thing('door', 0, 1, [action({ id: 'open' })]));
    const onFire = (c: Candidate) => fired.push(c.action.id);

    for (let i = 0; i < 5; i++) s.update(1 / 60, at(0, 0, 0, true), ctx(), onFire);
    expect(fired).toEqual(['open']);

    s.update(1 / 60, at(0, 0, 0, false), ctx(), onFire); // release
    s.update(1 / 60, at(0, 0, 0, true), ctx(), onFire);
    expect(fired).toEqual(['open', 'open']);
  });

  it('re-arms on a release that happens with nothing in reach', () => {
    // The early return for "no candidates" is a separate path; missing the
    // re-arm there leaves the button latched for good.
    const s = new InteractionSystem();
    const fired: string[] = [];
    s.register(thing('door', 0, 1, [action({ id: 'open', maxDistance: 2 })]));
    const onFire = (c: Candidate) => fired.push(c.action.id);

    s.update(1 / 60, at(0, 0, 0, true), ctx(), onFire);
    expect(fired).toEqual(['open']);

    // Walk out of range, let go, come back and press again.
    s.update(1 / 60, at(0, 50, 0, false), ctx(), onFire);
    s.update(1 / 60, at(0, 0, 0, true), ctx(), onFire);
    expect(fired).toEqual(['open', 'open']);
  });

  it('still completes a hold while the button stays down', () => {
    const s = new InteractionSystem();
    const fired: string[] = [];
    s.register(thing('safe', 0, 1, [action({ id: 'crack', holdSeconds: 0.5 })]));
    const onFire = (c: Candidate) => fired.push(c.action.id);

    for (let i = 0; i < 20; i++) s.update(1 / 30, at(0, 0, 0, true), ctx(), onFire);
    // Fires once at 0.5 s, then stays latched for the remaining frames.
    expect(fired).toEqual(['crack']);
  });
});
