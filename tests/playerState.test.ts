import { describe, it, expect, beforeEach } from 'vitest';
import {
  PlayerStateMachine,
  StateInput,
  JUMP_MIN_TIME,
  LAND_TIME,
  LAND_IMPACT_THRESHOLD,
  FALL_DELAY,
  RUN_ENTER,
  RUN_EXIT,
} from '../src/player/PlayerStateMachine';

const DT = 1 / 60;

function input(over: Partial<StateInput> = {}): StateInput {
  return {
    grounded: true,
    planarSpeed: 0,
    jumpTriggered: false,
    airTime: 0,
    justLanded: false,
    impactSpeed: 0,
    ...over,
  };
}

/** Run the machine for `seconds` with a constant input. */
function run(sm: PlayerStateMachine, seconds: number, over: Partial<StateInput> = {}) {
  const steps = Math.round(seconds / DT);
  for (let i = 0; i < steps; i++) sm.update(DT, input(over));
  return sm.state;
}

describe('PlayerStateMachine', () => {
  let sm: PlayerStateMachine;
  beforeEach(() => {
    sm = new PlayerStateMachine();
  });

  it('starts idle', () => {
    expect(sm.state).toBe('idle');
  });

  it('idle -> walk -> run -> walk -> idle', () => {
    expect(run(sm, 0.1, { planarSpeed: 1.4 })).toBe('walk');
    expect(run(sm, 0.1, { planarSpeed: 4.0 })).toBe('run');
    expect(run(sm, 0.1, { planarSpeed: 1.4 })).toBe('walk');
    expect(run(sm, 0.1, { planarSpeed: 0 })).toBe('idle');
  });

  it('holds state through the hysteresis band', () => {
    run(sm, 0.1, { planarSpeed: 4.0 });
    expect(sm.state).toBe('run');
    // Between RUN_EXIT and RUN_ENTER: whatever we were, we stay.
    const between = (RUN_EXIT + RUN_ENTER) / 2;
    expect(run(sm, 0.2, { planarSpeed: between })).toBe('run');

    const sm2 = new PlayerStateMachine();
    run(sm2, 0.1, { planarSpeed: 1.0 });
    expect(sm2.state).toBe('walk');
    expect(run(sm2, 0.2, { planarSpeed: between })).toBe('walk');
  });

  it('jump wins immediately from any ground state', () => {
    run(sm, 0.2, { planarSpeed: 4.0 });
    sm.update(DT, input({ jumpTriggered: true, grounded: false }));
    expect(sm.state).toBe('jump');
  });

  it('jump holds briefly, then becomes fall', () => {
    sm.update(DT, input({ jumpTriggered: true, grounded: false }));
    expect(sm.state).toBe('jump');
    // Still jumping just before the minimum hold elapses.
    run(sm, JUMP_MIN_TIME - 3 * DT, { grounded: false, airTime: 0.1 });
    expect(sm.state).toBe('jump');
    run(sm, 5 * DT, { grounded: false, airTime: 0.4 });
    expect(sm.state).toBe('fall');
  });

  it('a hard landing plays land, then returns to a ground state', () => {
    sm.update(DT, input({ jumpTriggered: true, grounded: false }));
    run(sm, 0.5, { grounded: false, airTime: 0.5 });
    expect(sm.state).toBe('fall');

    sm.update(DT, input({ grounded: true, justLanded: true, impactSpeed: 9 }));
    expect(sm.state).toBe('land');

    run(sm, LAND_TIME + 4 * DT, { grounded: true, planarSpeed: 0 });
    expect(sm.state).toBe('idle');
  });

  it('a soft landing skips the land clip', () => {
    sm.update(DT, input({ jumpTriggered: true, grounded: false }));
    run(sm, 0.5, { grounded: false, airTime: 0.5 });
    sm.update(
      DT,
      input({ grounded: true, justLanded: true, impactSpeed: LAND_IMPACT_THRESHOLD - 1 }),
    );
    expect(sm.state).toBe('idle');
  });

  it('walking off a ledge falls only after the coyote window', () => {
    run(sm, 0.2, { planarSpeed: 1.4 });
    expect(sm.state).toBe('walk');
    // Inside the grace period the character keeps walking.
    sm.update(DT, input({ grounded: false, airTime: FALL_DELAY * 0.5, planarSpeed: 1.4 }));
    expect(sm.state).toBe('walk');
    sm.update(DT, input({ grounded: false, airTime: FALL_DELAY * 2, planarSpeed: 1.4 }));
    expect(sm.state).toBe('fall');
  });

  it('landing then immediately running skips the rest of the land clip', () => {
    sm.reset('land');
    sm.update(DT, input({ grounded: true, planarSpeed: 4.0 }));
    expect(sm.state).toBe('run');
  });

  it('flags the frame a state changes', () => {
    sm.update(DT, input({ planarSpeed: 1.4 }));
    expect(sm.changed).toBe(true);
    sm.update(DT, input({ planarSpeed: 1.4 }));
    expect(sm.changed).toBe(false);
  });

  it('tracks time in state', () => {
    run(sm, 0.5, { planarSpeed: 1.4 });
    expect(sm.timeInState).toBeGreaterThan(0.4);
    sm.update(DT, input({ jumpTriggered: true, grounded: false }));
    expect(sm.timeInState).toBe(0);
  });
});
