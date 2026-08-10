import { describe, expect, it } from 'vitest';
import {
  FlightModel,
  PLANE_TUNING,
  NEUTRAL_INPUT,
  type FlightHost,
  type FlightInput,
} from '../src/flight/FlightModel';

/**
 * The aeroplane, flown in a millisecond.
 *
 * `FlightModel` reads no clock and touches no scene, which is what makes a
 * full takeoff-circuit-landing something a unit test can do rather than
 * something only a browser can. Acceptance criterion 1 is checked here first
 * and in Playwright second; if it cannot be flown by arithmetic it will not be
 * flyable with a keyboard either.
 */

/** Flat ground at sea level, which is what the airstrip is. */
const FLAT: FlightHost = { groundAt: () => 0 };

/** A ridge, for the terrain-following and crash cases. */
const RIDGE: FlightHost = {
  groundAt: (x) => (x > 200 && x < 260 ? 40 : 0),
};

const input = (over: Partial<FlightInput> = {}): FlightInput => ({
  ...NEUTRAL_INPUT,
  ...over,
});

/** Run the model for `seconds` at 60 Hz with a fixed input. */
function fly(m: FlightModel, seconds: number, over: Partial<FlightInput> = {}): void {
  const i = input(over);
  const steps = Math.round(seconds * 60);
  for (let s = 0; s < steps; s++) m.advance(1 / 60, i);
}

/** Run with a per-step input, for anything that needs closed-loop control. */
function flyWith(
  m: FlightModel,
  seconds: number,
  pilot: (t: number) => Partial<FlightInput>,
): void {
  const steps = Math.round(seconds * 60);
  for (let s = 0; s < steps; s++) {
    m.advance(1 / 60, input(pilot(s / 60)));
  }
}

describe('on the ground', () => {
  it('starts stopped, level and on its wheels', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);
    const s = m.state();
    expect(s.onGround).toBe(true);
    expect(s.airspeed).toBe(0);
    expect(s.roll).toBe(0);
    expect(s.altitudeAgl).toBeCloseTo(PLANE_TUNING.gearHeight, 3);
  });

  it('taxis forward under power and stops under brakes', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);
    fly(m, 4, { throttle: 0.35 });
    const rolling = m.airspeed;
    expect(rolling).toBeGreaterThan(3);
    expect(m.onGround, 'a taxi is not a takeoff').toBe(true);

    fly(m, 6, { throttle: 0, brake: true });
    expect(m.airspeed).toBeLessThan(1);
  });

  it('steers on the nosewheel, and turns tighter when slow', () => {
    const fast = new FlightModel(FLAT);
    fast.placeAt(0, 0, 0);
    fly(fast, 6, { throttle: 0.6 });
    const beforeFast = fast.state().yaw;
    fly(fast, 1, { throttle: 0.6, yaw: 1 });
    const fastTurn = Math.abs(fast.state().yaw - beforeFast);

    const slow = new FlightModel(FLAT);
    slow.placeAt(0, 0, 0);
    fly(slow, 1, { throttle: 0.15 });
    const beforeSlow = slow.state().yaw;
    fly(slow, 1, { throttle: 0.15, yaw: 1 });
    const slowTurn = Math.abs(slow.state().yaw - beforeSlow);

    expect(slowTurn).toBeGreaterThan(fastTurn);
  });

  it('will not rotate below flying speed, however hard you pull', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);
    fly(m, 2, { throttle: 0.2, pitch: 1 });
    expect(m.airspeed).toBeLessThan(PLANE_TUNING.stallSpeed * 0.82);
    expect(m.state().pitch, 'the tail has no air over it yet').toBe(0);
    expect(m.onGround).toBe(true);
  });
});

describe('takeoff', () => {
  it('leaves the ground near the rotate speed, not before', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);

    let liftoffSpeed = 0;
    for (let s = 0; s < 60 * 40 && m.onGround; s++) {
      m.advance(1 / 60, input({ throttle: 1, pitch: m.airspeed > 24 ? 0.7 : 0 }));
      liftoffSpeed = m.airspeed;
    }

    expect(m.onGround, 'it must actually get airborne').toBe(false);
    // Above the stall, and not absurdly above it.
    expect(liftoffSpeed).toBeGreaterThan(PLANE_TUNING.stallSpeed);
    expect(liftoffSpeed).toBeLessThan(PLANE_TUNING.cruiseSpeed);
  });

  it('climbs away and keeps climbing', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);
    flyWith(m, 30, (t) => ({ throttle: 1, pitch: t > 6 ? 0.55 : 0 }));

    const s = m.state();
    expect(s.onGround).toBe(false);
    expect(s.altitudeAgl, 'thirty seconds should buy real height').toBeGreaterThan(60);
    expect(s.verticalSpeed).toBeGreaterThan(0);
  });
});

describe('assisted flight', () => {
  it('returns to wings level on its own when the stick is centred', () => {
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 200, 0, 0, PLANE_TUNING.cruiseSpeed);
    fly(m, 1.2, { throttle: 0.7, roll: 1 });
    const banked = Math.abs(m.state().roll);
    expect(banked).toBeGreaterThan(0.3);

    fly(m, 6, { throttle: 0.7 });
    expect(Math.abs(m.state().roll), 'hands off means wings level').toBeLessThan(0.08);
  });

  it('refuses to bank past its limit', () => {
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 300, 0, 0, PLANE_TUNING.cruiseSpeed);
    fly(m, 12, { throttle: 0.8, roll: 1 });
    expect(Math.abs(m.state().roll)).toBeLessThanOrEqual(0.86);
  });

  it('pushes the nose down before it can stall', () => {
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 400, 0, 0, PLANE_TUNING.cruiseSpeed);
    // Throttle closed and held hard back: the classic way to stall an
    // aeroplane, and the thing assisted mode exists to prevent.
    fly(m, 14, { throttle: 0, pitch: 1 });
    expect(m.stalled, 'assisted flight does not stall').toBe(false);
    expect(m.state().altitudeAgl, 'and it is still flying').toBeGreaterThan(0);
  });

  it('is the default', () => {
    const m = new FlightModel(FLAT);
    expect(m.assist).toBe('assisted');
    expect(m.state().assist).toBe('assisted');
  });

  it('holds height through a long banked turn', () => {
    // The one that matters most, and the one the first circuit failed on.
    // Banking tilts lift sideways, so a level-pitch turn descends — the first
    // version flew a good climb and then sank 116 m into the ground over a
    // twenty-six second turn, stalling on the way down. A pilot answers a bank
    // with back pressure without thinking; assisted mode has to as well.
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 300, 0, 0, PLANE_TUNING.cruiseSpeed);
    fly(m, 2, { throttle: 0.85 });
    const before = m.state().altitudeAgl;

    fly(m, 26, { throttle: 0.85, roll: 0.55 });
    const after = m.state();

    // A real banked turn loses a little height and that is fine — this one
    // sheds about 40 m over twenty-six seconds. What it must not do is the
    // original failure: 116 m, a stall, and the ground.
    expect(after.altitudeAgl, 'a turn is not a dive').toBeGreaterThan(before - 80);
    expect(after.stalled, 'and not a spiral').toBe(false);
    expect(after.airspeed).toBeGreaterThan(PLANE_TUNING.stallSpeed);
  });

  it('still holds level when the wings are level', () => {
    // The compensation is scaled by sin(roll), so it must vanish at zero —
    // otherwise the aeroplane climbs forever with the stick centred.
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 300, 0, 0, PLANE_TUNING.cruiseSpeed);
    fly(m, 20, { throttle: 0.72 });
    const s = m.state();
    expect(Math.abs(s.verticalSpeed), 'hands off is hands off').toBeLessThan(4);
  });
});

describe('reduced assist', () => {
  it('lets the aeroplane stall, and recovers when the nose goes down', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(0, 500, 0, 0, PLANE_TUNING.cruiseSpeed);

    // Throttle closed, nose held up: the aeroplane runs out of speed. Checked
    // while it is happening rather than at some fixed later time — an
    // unattended stall drops the nose, gains speed and recovers itself, so a
    // test that only looks at the end sees a healthy aeroplane and concludes
    // the stall never happened.
    let everStalled = false;
    let warnedFirst = false;
    for (let s = 0; s < 60 * 12; s++) {
      m.advance(1 / 60, input({ throttle: 0, pitch: 1 }));
      const st = m.state();
      if (st.stallWarning && !everStalled) warnedFirst = true;
      if (st.stalled) everStalled = true;
    }
    expect(everStalled, 'this is what reduced assist is for').toBe(true);
    expect(warnedFirst, 'and it warned before it broke').toBe(true);

    // The recovery every pilot is taught: nose down, power on.
    fly(m, 12, { throttle: 1, pitch: -0.5 });
    expect(m.stalled, 'nose down and power recovers it').toBe(false);
    expect(m.airspeed).toBeGreaterThan(PLANE_TUNING.stallSpeed);
  });

  it('holds a bank the assisted mode would have levelled', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(0, 300, 0, 0, PLANE_TUNING.cruiseSpeed);
    fly(m, 1.2, { throttle: 0.7, roll: 1 });
    const banked = Math.abs(m.state().roll);
    fly(m, 3, { throttle: 0.7 });
    // Weak dihedral damping only — most of the bank survives.
    expect(Math.abs(m.state().roll)).toBeGreaterThan(banked * 0.3);
  });
});

describe('the stall warning', () => {
  it('sounds before the stall, not with it', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(0, 400, 0, 0, PLANE_TUNING.stallSpeed * 1.1);
    const s = m.state();
    expect(s.stallWarning, 'warned').toBe(true);
    expect(s.stalled, 'but not yet stalled').toBe(false);
  });

  it('is silent on the ground, where slow is normal', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);
    fly(m, 2, { throttle: 0.2 });
    expect(m.state().stallWarning).toBe(false);
  });
});

describe('landing', () => {
  it('a gentle touchdown is a landing', () => {
    const m = new FlightModel(FLAT);
    // On final: low, slow, descending gently.
    m.placeFlying(0, 12, 0, 0, PLANE_TUNING.stallSpeed * 1.35);
    flyWith(m, 20, () => ({ throttle: 0.25, pitch: -0.06 }));

    expect(m.onGround, 'it should be down').toBe(true);
    expect(m.crashed, 'and in one piece').toBe(false);
  });

  it('an arrival at a high sink rate is a crash', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(0, 60, 0, 0, PLANE_TUNING.cruiseSpeed);
    // Straight at the ground, full power.
    flyWith(m, 12, () => ({ throttle: 1, pitch: -1 }));

    expect(m.onGround).toBe(true);
    expect(m.crashed, 'that was not a landing').toBe(true);
  });

  it('a crash can be cleared, which is what recovery does', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(0, 60, 0, 0, PLANE_TUNING.cruiseSpeed);
    flyWith(m, 12, () => ({ throttle: 1, pitch: -1 }));
    expect(m.crashed).toBe(true);

    m.clearCrash();
    m.placeAt(0, 0, 0);
    expect(m.crashed).toBe(false);
    expect(m.state().airspeed).toBe(0);
    expect(m.state().roll).toBe(0);
    expect(m.onGround).toBe(true);
  });
});

describe('a full circuit', () => {
  /**
   * Acceptance criterion 1, as arithmetic.
   *
   * Take off, climb, turn through 360 degrees, come back and land. No
   * closed-loop guidance beyond "hold this attitude for this long", because a
   * circuit that only a controller can fly is not one a player can.
   */
  it('takes off, turns all the way round, and lands again', () => {
    const m = new FlightModel(FLAT);
    m.placeAt(0, 0, 0);

    // Roll and rotate.
    let t = 0;
    const step = (seconds: number, over: Partial<FlightInput>) => {
      const n = Math.round(seconds * 60);
      for (let i = 0; i < n; i++) {
        m.advance(1 / 60, input(over));
        t += 1 / 60;
      }
    };

    step(12, { throttle: 1 });                    // takeoff roll
    step(10, { throttle: 1, pitch: 0.6 });        // rotate and climb
    expect(m.onGround, 'airborne by now').toBe(false);
    const climbed = m.state().altitudeAgl;
    expect(climbed).toBeGreaterThan(30);

    const headingStart = m.state().yaw;
    step(26, { throttle: 0.85, roll: 0.55 });     // the turn
    const turned = Math.abs(m.state().yaw - headingStart);
    expect(turned, 'a full circle or more').toBeGreaterThan(Math.PI * 1.5);

    step(6, { throttle: 0.8 });                   // wings level again
    expect(Math.abs(m.state().roll)).toBeLessThan(0.2);

    // Descend. Controls are *rate* controls, so the nose is pushed down for a
    // moment and then the stick is centred — holding a gentle nose-down input
    // for forty seconds walks the attitude to the stop and arrives vertically,
    // which is what the first version of this test did.
    // Throttle *closed* for the approach. A quarter of power with turn
    // compensation holding the nose up is very nearly level flight, and the
    // first version of this simply cruised until the loop ran out.
    step(2, { throttle: 0, pitch: -0.5 });
    // A 34 m/s aeroplane with a good glide takes its time coming down, and
    // that is the point of it being a sightseeing aircraft rather than a jet.
    for (let i = 0; i < 200 * 60 && !m.onGround; i++) {
      m.advance(1 / 60, input({ throttle: 0 }));
      t += 1 / 60;
    }

    const s = m.state();
    expect(s.onGround, 'back on the ground').toBe(true);
    expect(m.crashed, 'and not a smoking hole').toBe(false);
    expect(t, 'the whole circuit inside four minutes').toBeLessThan(240);
  });
});

describe('terrain', () => {
  it('lands on a ridge at ridge height, not at sea level', () => {
    const m = new FlightModel(RIDGE);
    m.placeFlying(230, 60, 0, 0, PLANE_TUNING.stallSpeed * 1.3);
    flyWith(m, 30, () => ({ throttle: 0.2, pitch: -0.1 }));
    if (m.onGround) {
      expect(m.state().position.y).toBeGreaterThan(30);
    }
  });

  it('reports height above the terrain below, not above zero', () => {
    const m = new FlightModel(RIDGE);
    m.placeFlying(230, 100, 0, 0, 40);
    expect(m.state().altitudeAgl).toBeCloseTo(60, 1);
  });
});

describe('save and load', () => {
  it('round-trips position, attitude, velocity and assist', () => {
    const m = new FlightModel(FLAT);
    m.setAssist('reduced');
    m.placeFlying(120, 300, -40, 1.1, 50);
    fly(m, 3, { throttle: 0.9, roll: 0.4, pitch: 0.2 });

    const saved = m.toJSON();
    const other = new FlightModel(FLAT);
    other.restore(saved);

    const a = m.state();
    const b = other.state();
    expect(b.position.x).toBeCloseTo(a.position.x, 4);
    expect(b.position.y).toBeCloseTo(a.position.y, 4);
    expect(b.yaw).toBeCloseTo(a.yaw, 4);
    expect(b.roll).toBeCloseTo(a.roll, 4);
    expect(b.airspeed).toBeCloseTo(a.airspeed, 4);
    expect(b.assist).toBe('reduced');
  });

  it('refuses a corrupt save rather than propagating a NaN', () => {
    const m = new FlightModel(FLAT);
    m.restore({
      x: Number.NaN,
      y: Infinity,
      yaw: 'north' as unknown as number,
      throttle: 99,
      assist: 'wobbly' as unknown as 'assisted',
    });
    const s = m.state();
    expect(Number.isFinite(s.position.x)).toBe(true);
    expect(Number.isFinite(s.position.y)).toBe(true);
    expect(Number.isFinite(s.yaw)).toBe(true);
    expect(s.throttle).toBeLessThanOrEqual(1);
    expect(s.assist, 'an unknown assist level is the safe one').toBe('assisted');
  });

  it('comes back level and uncrashed', () => {
    const m = new FlightModel(FLAT);
    m.restore({ x: 0, y: 100, z: 0, roll: 5, pitch: 5 });
    expect(Math.abs(m.state().roll)).toBeLessThanOrEqual(PLANE_TUNING.maxRoll);
    expect(Math.abs(m.state().pitch)).toBeLessThanOrEqual(PLANE_TUNING.maxPitch);
    expect(m.crashed).toBe(false);
  });
});

describe('the integrator', () => {
  it('splits a long step rather than tunnelling through the ground', () => {
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 8, 0, 0, 60);
    // One five-second step at 60 m/s is 300 m of travel. A naive integrator
    // puts the aeroplane underground; this must resolve the ground instead.
    m.advance(5, input({ throttle: 0, pitch: -0.6 }));
    expect(m.state().position.y).toBeGreaterThanOrEqual(0);
    expect(m.state().altitudeAgl).toBeGreaterThanOrEqual(-0.01);
  });

  it('ignores a zero or negative step', () => {
    const m = new FlightModel(FLAT);
    m.placeFlying(0, 100, 0, 0, 40);
    const before = m.state().position.x;
    m.advance(0, input({ throttle: 1 }));
    m.advance(-1, input({ throttle: 1 }));
    expect(m.state().position.x).toBe(before);
  });
});
