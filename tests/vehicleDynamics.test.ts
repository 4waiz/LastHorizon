import { describe, it, expect } from 'vitest';
import {
  BICYCLE, HATCHBACK, POLICE, SCOOTER, VAN, VEHICLES,
  steeringLimitAt,
} from '../src/vehicles/VehicleDefinition';
import {
  NEUTRAL_INPUT, STOPPED_SPEED,
  balanceTorque, conditionGripScale, gearLabel, leanFromUp, normaliseInput,
  resolveDrive, speedKmh, stepSteering, visualLean,
  type VehicleInput,
} from '../src/vehicles/VehicleDynamics';

const input = (over: Partial<VehicleInput> = {}): VehicleInput => ({ ...NEUTRAL_INPUT, ...over });
const DT = 1 / 60;

/** Run steering forward until it settles, and report where it landed. */
function settleSteering(def = HATCHBACK, steer = 1, speed = 0, frames = 240): number {
  let angle = 0;
  for (let i = 0; i < frames; i++) angle = stepSteering(def, angle, input({ steer }), speed, DT);
  return angle;
}

describe('input normalisation', () => {
  it('clamps everything into range', () => {
    const n = normaliseInput({ steer: 5, throttle: 9, brake: -2 });
    expect(n.steer).toBe(1);
    expect(n.throttle).toBe(1);
    expect(n.brake).toBe(0);
  });

  it('turns a non-finite reading into released, not full', () => {
    // A garbage reading must fail toward "not pressed". Clamping Infinity to 1
    // would floor the accelerator off a corrupt value, which is the worst
    // available interpretation of unknown input.
    const n = normaliseInput({ steer: Number.NaN, throttle: Number.POSITIVE_INFINITY });
    expect(n.steer).toBe(0);
    expect(n.throttle).toBe(0);
    expect(n.brake).toBe(0);
  });

  it('still clamps an ordinary over-range value rather than discarding it', () => {
    // 1.5 is a plausible rounding artefact, not corruption; it means "full".
    expect(normaliseInput({ throttle: 1.5 }).throttle).toBe(1);
  });

  it('treats a missing field as released', () => {
    expect(normaliseInput({})).toEqual(NEUTRAL_INPUT);
  });
});

describe('steering', () => {
  it('turns toward the input rather than snapping', () => {
    const oneFrame = stepSteering(HATCHBACK, 0, input({ steer: 1 }), 0, DT);
    expect(oneFrame).toBeGreaterThan(0);
    expect(oneFrame).toBeLessThan(HATCHBACK.steering.maxAngle);
  });

  it('reaches full lock at a standstill given time', () => {
    expect(settleSteering(HATCHBACK, 1, 0)).toBeCloseTo(HATCHBACK.steering.maxAngle, 4);
  });

  it('is symmetric — left mirrors right exactly', () => {
    // Reversing and steering symmetry are acceptance criteria, and a sign slip
    // here is the classic way to get a car that turns better one way.
    for (const def of VEHICLES) {
      for (const speed of [0, 5, 15]) {
        expect(settleSteering(def, 1, speed)).toBeCloseTo(-settleSteering(def, -1, speed), 9);
      }
    }
  });

  it('tightens the lock as speed rises', () => {
    const slow = settleSteering(HATCHBACK, 1, 1);
    const fast = settleSteering(HATCHBACK, 1, HATCHBACK.drive.maxSpeed);
    expect(fast).toBeLessThan(slow);
    expect(fast).toBeGreaterThan(0);
  });

  it('pulls an existing angle in when the car speeds up', () => {
    // Held at full lock while accelerating, the angle has to follow the
    // shrinking limit down -- otherwise a slow full-lock turn becomes an
    // impossible high-speed one just by pressing the throttle.
    const parked = settleSteering(HATCHBACK, 1, 0);
    const nowFast = stepSteering(HATCHBACK, parked, input({ steer: 1 }), HATCHBACK.drive.maxSpeed, DT);
    expect(nowFast).toBeLessThan(parked);
    expect(nowFast).toBeLessThanOrEqual(steeringLimitAt(HATCHBACK, HATCHBACK.drive.maxSpeed) + 1e-9);
  });

  it('self-centres when released, faster than it turns', () => {
    const held = settleSteering(HATCHBACK, 1, 4);
    let a = held;
    for (let i = 0; i < 5; i++) a = stepSteering(HATCHBACK, a, NEUTRAL_INPUT, 4, DT);
    const returned = held - a;

    let b = 0;
    for (let i = 0; i < 5; i++) b = stepSteering(HATCHBACK, b, input({ steer: 1 }), 4, DT);
    expect(returned).toBeGreaterThan(b);
  });

  it('settles exactly at centre rather than oscillating past it', () => {
    let a = settleSteering(HATCHBACK, 1, 4);
    for (let i = 0; i < 300; i++) a = stepSteering(HATCHBACK, a, NEUTRAL_INPUT, 4, DT);
    expect(a).toBe(0);
  });

  it('ignores a bad timestep instead of producing NaN', () => {
    expect(stepSteering(HATCHBACK, 0.2, input({ steer: 1 }), 0, Number.NaN)).toBe(0.2);
    expect(stepSteering(HATCHBACK, 0.2, input({ steer: 1 }), 0, -1)).toBe(0.2);
  });

  it('never exceeds the limit for the current speed, on any vehicle', () => {
    for (const def of VEHICLES) {
      for (const speed of [0, 3, 10, 25, 100]) {
        const a = settleSteering(def, 1, speed);
        expect(Math.abs(a)).toBeLessThanOrEqual(steeringLimitAt(def, speed) + 1e-9);
      }
    }
  });
});

describe('the automatic transmission', () => {
  it('accelerates forward on throttle', () => {
    const d = resolveDrive(HATCHBACK, input({ throttle: 1 }), 0);
    expect(d.engineForce).toBeGreaterThan(0);
    expect(d.brakeForce).toBe(0);
    expect(d.gear).toBe('drive');
  });

  it('brakes while rolling forward', () => {
    const d = resolveDrive(HATCHBACK, input({ brake: 1 }), 10);
    expect(d.brakeForce).toBeGreaterThan(0);
    expect(d.engineForce).toBe(0);
    expect(d.gear).toBe('drive');
  });

  it('reverses once stopped and the brake is still held', () => {
    const d = resolveDrive(HATCHBACK, input({ brake: 1 }), 0);
    expect(d.engineForce).toBeLessThan(0);
    expect(d.gear).toBe('reverse');
  });

  it('brakes rather than lurching when throttle is pressed while rolling back', () => {
    // A car that has crept back down a slope must slow first. Applying forward
    // engine force against backward motion is what makes pulling away lurch.
    const d = resolveDrive(HATCHBACK, input({ throttle: 1 }), -3);
    expect(d.engineForce).toBe(0);
    expect(d.brakeForce).toBeGreaterThan(0);
    expect(d.gear).toBe('reverse');
  });

  it('coasts to a stop with nothing pressed', () => {
    const rolling = resolveDrive(HATCHBACK, NEUTRAL_INPUT, 12);
    expect(rolling.engineForce).toBe(0);
    expect(rolling.brakeForce).toBeGreaterThan(0);
    expect(rolling.brakeForce).toBeLessThan(HATCHBACK.drive.brakeForce);
    expect(rolling.gear).toBe('drive');
  });

  it('reports neutral only when actually stopped', () => {
    expect(resolveDrive(HATCHBACK, NEUTRAL_INPUT, 0).gear).toBe('neutral');
    expect(resolveDrive(HATCHBACK, NEUTRAL_INPUT, 5).gear).toBe('drive');
    expect(resolveDrive(HATCHBACK, NEUTRAL_INPUT, -5).gear).toBe('reverse');
  });

  it('cuts the engine at top speed instead of fighting the limiter', () => {
    const atLimit = resolveDrive(HATCHBACK, input({ throttle: 1 }), HATCHBACK.drive.maxSpeed);
    expect(atLimit.engineForce).toBe(0);
    // No counter-force either: pushing back would make top speed feel springy.
    expect(atLimit.brakeForce).toBe(0);
  });

  it('limits reverse separately from forward', () => {
    const atLimit = resolveDrive(HATCHBACK, input({ brake: 1 }), -HATCHBACK.drive.maxReverseSpeed);
    expect(atLimit.engineForce).toBe(0);
  });

  it('reverses more gently than it drives', () => {
    const fwd = resolveDrive(HATCHBACK, input({ throttle: 1 }), 0).engineForce;
    const rev = resolveDrive(HATCHBACK, input({ brake: 1 }), 0).engineForce;
    expect(Math.abs(rev)).toBeLessThan(Math.abs(fwd));
  });

  it('scales with a partly-pressed pedal', () => {
    const half = resolveDrive(HATCHBACK, input({ throttle: 0.5 }), 0).engineForce;
    const full = resolveDrive(HATCHBACK, input({ throttle: 1 }), 0).engineForce;
    expect(half).toBeCloseTo(full / 2, 6);
  });

  it('gives the handbrake priority over everything', () => {
    const d = resolveDrive(HATCHBACK, input({ throttle: 1, handbrake: true }), 10);
    expect(d.engineForce).toBe(0);
    expect(d.brakeForce).toBe(HATCHBACK.drive.brakeForce);
  });

  it('tolerates the jitter of a parked car', () => {
    // A stopped vehicle never reads exactly zero. If the threshold were tight,
    // brake-to-reverse would fail intermittently and read as dead controls.
    for (const speed of [0.01, -0.01, 0.3, -0.3]) {
      expect(Math.abs(speed)).toBeLessThan(STOPPED_SPEED);
      expect(resolveDrive(HATCHBACK, input({ brake: 1 }), speed).gear).toBe('reverse');
    }
  });

  it('never produces a non-finite force, whatever the speed', () => {
    for (const def of VEHICLES) {
      for (const speed of [0, 50, -50, Number.NaN, Number.POSITIVE_INFINITY]) {
        const d = resolveDrive(def, input({ throttle: 1, brake: 1 }), speed);
        expect(Number.isFinite(d.engineForce)).toBe(true);
        expect(Number.isFinite(d.brakeForce)).toBe(true);
        expect(d.brakeForce).toBeGreaterThanOrEqual(0);
      }
    }
  });
});

describe('two-wheel balance', () => {
  it('pushes back toward upright', () => {
    // Leaning right should produce a torque to the left, and vice versa.
    expect(balanceTorque(BICYCLE, 0.3, 0, 0).torque).toBeLessThan(0);
    expect(balanceTorque(BICYCLE, -0.3, 0, 0).torque).toBeGreaterThan(0);
  });

  it('does nothing when already upright and still', () => {
    expect(balanceTorque(BICYCLE, 0, 0, 0).torque).toBeCloseTo(0, 9);
  });

  it('never exceeds the cap, however far over the bike is', () => {
    // This is the guarantee behind "the player is never launched", so it is
    // checked against absurd inputs rather than plausible ones.
    for (const def of [BICYCLE, SCOOTER]) {
      for (const lean of [0.1, 0.5, 0.9]) {
        for (const rate of [0, 50, -50, 5000]) {
          const r = balanceTorque(def, lean, rate, 0);
          expect(Math.abs(r.torque)).toBeLessThanOrEqual(def.balance!.maxRecoveryTorque + 1e-9);
        }
      }
    }
  });

  it('assists most at a standstill, where a real bike is least stable', () => {
    const parked = balanceTorque(SCOOTER, 0.2, 0, 0);
    const moving = balanceTorque(SCOOTER, 0.2, 0, SCOOTER.drive.maxSpeed);
    expect(parked.assist).toBeGreaterThan(moving.assist);
    expect(Math.abs(parked.torque)).toBeGreaterThan(Math.abs(moving.torque));
  });

  it('never withdraws assistance entirely', () => {
    const fast = balanceTorque(SCOOTER, 0.2, 0, 1000);
    expect(fast.assist).toBeGreaterThan(0.3);
    expect(Math.abs(fast.torque)).toBeGreaterThan(0);
  });

  it('damps, so it settles instead of oscillating', () => {
    // Falling right (positive rate) while already leaning right must produce
    // more correction than leaning the same amount but stationary.
    const still = balanceTorque(BICYCLE, 0.2, 0, 0).torque;
    const falling = balanceTorque(BICYCLE, 0.2, 1.5, 0).torque;
    expect(falling).toBeLessThan(still);
  });

  it('stops fighting once the rider is down', () => {
    // Continuing to push a bike that is already over is what makes a vehicle
    // thrash on its side.
    const down = balanceTorque(BICYCLE, BICYCLE.balance!.fallAngle + 0.1, 0, 0);
    expect(down.fallen).toBe(true);
    expect(down.torque).toBe(0);
  });

  it('is not fallen while merely leaning hard', () => {
    const hard = balanceTorque(BICYCLE, BICYCLE.balance!.maxLean, 0, 5);
    expect(hard.fallen).toBe(false);
  });

  it('returns nothing at all for a car', () => {
    expect(balanceTorque(HATCHBACK, 0.5, 1, 0)).toEqual({ torque: 0, assist: 0, fallen: false });
  });

  it('survives non-finite state', () => {
    const r = balanceTorque(BICYCLE, Number.NaN, Number.NaN, Number.NaN);
    expect(Number.isFinite(r.torque)).toBe(true);
  });
});

describe('lean, from geometry and for looks', () => {
  it('reads upright as no lean', () => {
    expect(leanFromUp(0, 1)).toBeCloseTo(0, 9);
  });

  it('reads a tilt as a signed angle', () => {
    expect(leanFromUp(0.5, 0.866)).toBeGreaterThan(0);
    expect(leanFromUp(-0.5, 0.866)).toBeLessThan(0);
  });

  it('handles the bike being fully on its side', () => {
    expect(Math.abs(leanFromUp(1, 0))).toBeCloseTo(Math.PI / 2, 3);
  });

  it('leans into a corner, opposite the steering sign', () => {
    const right = visualLean(SCOOTER, 0.3, 10);
    expect(right).toBeLessThan(0);
    expect(visualLean(SCOOTER, -0.3, 10)).toBeGreaterThan(0);
  });

  it('does not lean when barely moving, however hard the bars are turned', () => {
    // Full lock at walking pace is a tight turn, not a lean.
    expect(Math.abs(visualLean(SCOOTER, 0.5, 0))).toBeCloseTo(0, 6);
  });

  it('stays within the configured maximum', () => {
    for (const def of [BICYCLE, SCOOTER]) {
      const extreme = visualLean(def, 10, def.drive.maxSpeed * 5);
      expect(Math.abs(extreme)).toBeLessThanOrEqual(def.balance!.maxLean + 1e-9);
    }
  });

  it('is zero for a car', () => {
    expect(visualLean(VAN, 0.4, 15)).toBe(0);
  });
});

describe('reporting', () => {
  it('shows speed in km/h, unsigned', () => {
    expect(speedKmh(10)).toBeCloseTo(36, 6);
    expect(speedKmh(-10)).toBeCloseTo(36, 6);
    expect(speedKmh(Number.NaN)).toBe(0);
  });

  it('labels gears the way a dashboard does', () => {
    expect(gearLabel('drive')).toBe('D');
    expect(gearLabel('reverse')).toBe('R');
    expect(gearLabel('neutral')).toBe('N');
  });
});

describe('damage affects grip, gently', () => {
  it('leaves a healthy vehicle alone', () => {
    expect(conditionGripScale(HATCHBACK, 1)).toBe(1);
    expect(conditionGripScale(HATCHBACK, HATCHBACK.damage.impairedBelow)).toBe(1);
  });

  it('degrades below the threshold', () => {
    expect(conditionGripScale(HATCHBACK, 0.1)).toBeLessThan(1);
  });

  it('never strands the player in an undriveable car', () => {
    for (const def of VEHICLES) {
      expect(conditionGripScale(def, 0)).toBeGreaterThanOrEqual(0.8);
    }
  });
});

describe('the fleet drives the way it reads', () => {
  it('accelerates the police car harder than the hatchback', () => {
    const p = resolveDrive(POLICE, input({ throttle: 1 }), 0).engineForce / POLICE.mass;
    const h = resolveDrive(HATCHBACK, input({ throttle: 1 }), 0).engineForce / HATCHBACK.mass;
    expect(p).toBeGreaterThan(h);
  });

  it('makes the van the most reluctant thing in the fleet', () => {
    const accel = (d: typeof VAN) => resolveDrive(d, input({ throttle: 1 }), 0).engineForce / d.mass;
    expect(accel(VAN)).toBeLessThan(accel(HATCHBACK));
    expect(accel(VAN)).toBeLessThan(accel(POLICE));
  });

  it('gives every vehicle a usable turning circle at walking pace', () => {
    for (const def of VEHICLES) {
      expect(settleSteering(def, 1, 1.5)).toBeGreaterThan(0.2);
    }
  });
});
