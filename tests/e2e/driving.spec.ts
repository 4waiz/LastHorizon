import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Driving, against real Rapier.
 *
 * `VehicleDynamics` is pure and exhaustively unit-tested, and it was still
 * possible for every vehicle in the fleet to be three to seven times too
 * powerful and to brake at 48 m/s². The force maths was right; the *numbers*
 * disagreed with each other, and only driving showed it. These tests exist to
 * keep the tuning honest.
 *
 * Runs are deliberately short. The village has buildings in it, and a vehicle
 * left at full throttle for ten seconds ends up measuring a collision rather
 * than a controller.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function boot(page: Page) {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
}

/** A clear stretch of the coast road, pointing along it. */
const START = { x: 0, z: 30 };

const KINDS = ['bicycle', 'scooter', 'hatchback', 'van', 'police'] as const;

/** Spawn, let the suspension settle, hold throttle, and report. */
async function accelerationRun(page: Page, kind: string, seconds = 3) {
  return page.evaluate(
    async ([k, secs, sx, sz]) => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle(k as string, sx as number, sz as number, 0);
      if (!id) return null;
      t.settle(60);
      const rest = t.getVehicle(id)!;

      t.setVehicleInput(id, { throttle: 1 });
      t.settle(Math.round((secs as number) * 60));
      const moving = t.getVehicle(id)!;

      t.despawnVehicle(id);
      return {
        restWheels: rest.wheelsOnGround,
        restUpright: rest.upright,
        restGear: rest.gear,
        speed: moving.forwardSpeed,
        kmh: moving.speedKmh,
        wheels: moving.wheelsOnGround,
        upright: moving.upright,
        gear: moving.gear,
        recoveries: moving.recoveries,
      };
    },
    [kind, seconds, START.x, START.z] as const,
  );
}

test.describe('driving', () => {
  // One test per vehicle rather than a loop inside one test. `settle()` renders
  // the whole village every frame, so five vehicles in a single test is
  // thousands of rendered frames and blows the timeout -- and a failure names
  // the vehicle instead of just the batch.
  for (const kind of KINDS) {
    test(`${kind} settles on its wheels, upright and in neutral`, async ({ page }) => {
      const errors = watchConsole(page);
      await boot(page);

      const run = await accelerationRun(page, kind, 0.1);
      expect(run, `${kind} failed to spawn`).not.toBeNull();
      expect(run!.restUpright).toBe(true);
      expect(run!.restGear).toBe('neutral');
      // Two wheels for the bicycle and scooter, four for everything else.
      expect(run!.restWheels).toBeGreaterThan(1);
      expect(run!.recoveries).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  for (const kind of KINDS) {
    test(`${kind} actually moves under power`, async ({ page }) => {
      const errors = watchConsole(page);
      await boot(page);

      const run = await accelerationRun(page, kind, 3);
      // The bicycle once did not move at all: its suspension could not carry
      // the rider's mass, so the wheels never drove the ground.
      expect(run!.speed / 3).toBeGreaterThan(0.3);
      expect(run!.gear).toBe('drive');
      expect(run!.upright).toBe(true);
      expect(run!.recoveries).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('acceleration is ordered the way the fleet reads', async ({ page }) => {
    test.setTimeout(600_000);
    const errors = watchConsole(page);
    await boot(page);

    const accel: Record<string, number> = {};
    for (const kind of ['bicycle', 'van', 'hatchback', 'police']) {
      const run = await accelerationRun(page, kind, 3);
      accel[kind] = run!.speed / 3;
    }

    expect(accel.police).toBeGreaterThan(accel.hatchback);
    expect(accel.hatchback).toBeGreaterThan(accel.van);
    expect(accel.van).toBeGreaterThan(accel.bicycle);
    expect(errors).toEqual([]);
  });

  test('a car keeps all four wheels down under full power', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    // Over-powered, the hatchback lifted its front wheels pulling away and
    // reached 50 km/h in two seconds against a claimed 9.5 s to 24 m/s.
    const run = await accelerationRun(page, 'hatchback', 2);
    expect(run!.wheels).toBe(4);
    expect(run!.kmh).toBeLessThan(35);
    expect(errors).toEqual([]);
  });

  test('braking stops a car in a sane distance, not instantly', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const braking = await page.evaluate(async ([sx, sz]) => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle('hatchback', sx as number, sz as number, 0)!;
      t.settle(120);
      t.setVehicleInput(id!, { throttle: 1 });
      t.settle(180);
      const from = t.getVehicle(id!)!.forwardSpeed;

      t.setVehicleInput(id!, { throttle: 0, brake: 1 });
      let frames = 0;
      while (t.getVehicle(id!)!.forwardSpeed > 0.6 && frames < 900) {
        t.settle(3);
        frames += 3;
      }
      const seconds = frames / 60;
      t.despawnVehicle(id!);
      return { from, seconds, decel: from / Math.max(seconds, 1e-6) };
    }, [START.x, START.z] as const);

    // `setWheelBrake` is not in newtons and saturates: at the original 14,000
    // every car stopped from 43 km/h in a quarter second, which is a crash.
    expect(braking.decel).toBeGreaterThan(4);
    expect(braking.decel).toBeLessThan(20);
    expect(braking.seconds).toBeGreaterThan(0.4);
    expect(errors).toEqual([]);
  });

  test('brake held at a standstill engages reverse and backs up', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const rev = await page.evaluate(async ([sx, sz]) => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle('hatchback', sx as number, sz as number, 0)!;
      t.settle(120);
      const before = t.getVehicle(id!)!;

      t.setVehicleInput(id!, { brake: 1 });
      t.settle(180);
      const after = t.getVehicle(id!)!;
      t.despawnVehicle(id!);
      return { beforeZ: before.z, gear: after.gear, speed: after.forwardSpeed, afterZ: after.z };
    }, [START.x, START.z] as const);

    expect(rev.gear).toBe('reverse');
    // Facing +Z, so reversing must decrease z and the forward speed is negative.
    expect(rev.speed).toBeLessThan(-0.5);
    expect(rev.afterZ).toBeLessThan(rev.beforeZ);
    expect(errors).toEqual([]);
  });

  test('steering is symmetric left and right', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const sym = await page.evaluate(async ([sx, sz]) => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle('hatchback', sx as number, sz as number, 0)!;
      t.settle(120);

      // Equal settling time each way, or the comparison is meaningless.
      t.setVehicleInput(id!, { steer: 1 });
      t.settle(120);
      const right = t.getVehicle(id!)!.steerAngle;

      t.setVehicleInput(id!, { steer: 0 });
      t.settle(120);
      t.setVehicleInput(id!, { steer: -1 });
      t.settle(120);
      const left = t.getVehicle(id!)!.steerAngle;

      t.despawnVehicle(id!);
      return { left, right };
    }, [START.x, START.z] as const);

    expect(sym.right).toBeGreaterThan(0.1);
    expect(sym.left).toBeLessThan(-0.1);
    expect(Math.abs(sym.right + sym.left)).toBeLessThan(0.02);
    expect(errors).toEqual([]);
  });

  test('a car at speed does not pass through a house', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    // Acceptance criterion. At 28 m/s a vehicle covers ~0.47 m per step, more
    // than a wall is thick, so this only holds because CCD is enabled.
    const crash = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle('police', 15.6, 8, 0)!;
      t.settle(90);
      t.setVehicleInput(id!, { throttle: 1 });

      let peak = 0;
      let frames = 0;
      while (frames < 900) {
        t.settle(6);
        frames += 6;
        const v = t.getVehicle(id!)!;
        peak = Math.max(peak, v.speedKmh);
        if (v.z > 40) break;
        if (v.speedKmh < 2 && frames > 240) break;
      }
      const end = t.getVehicle(id!)!;
      t.despawnVehicle(id!);
      return { peak, z: end.z, recoveries: end.recoveries };
    });

    expect(crash.peak).toBeGreaterThan(30);
    // The house sits at z = 33. Ending well beyond it would mean it went through.
    expect(crash.z).toBeLessThan(40);
    expect(crash.recoveries).toBe(0);
    expect(errors).toEqual([]);
  });

  for (const kind of ['bicycle', 'scooter']) {
    test(`${kind} stays up at low speed and through a hard turn`, async ({ page }) => {
      const errors = watchConsole(page);
      await boot(page);

      const ride = await page.evaluate(
        async ([k, sx, sz]) => {
          const t = window.__LH_TEST__!;
          const id = await t.spawnVehicle(k as string, sx as number, sz as number, 0)!;
          t.settle(60);

          // Crawl: the speed at which a real two-wheeler is least stable.
          t.setVehicleInput(id!, { throttle: 0.15 });
          t.settle(90);
          const crawling = t.getVehicle(id!)!;

          // Then a hard turn under power.
          t.setVehicleInput(id!, { throttle: 1, steer: 1 });
          t.settle(150);
          const turning = t.getVehicle(id!)!;

          t.despawnVehicle(id!);
          return {
            crawlUpright: crawling.upright,
            crawlFallen: crawling.fallen,
            turnUpright: turning.upright,
            turnFallen: turning.fallen,
            lean: turning.lean,
            recoveries: turning.recoveries,
          };
        },
        [kind, START.x, START.z] as const,
      );

      expect(ride.crawlUpright).toBe(true);
      expect(ride.crawlFallen).toBe(false);
      expect(ride.turnUpright).toBe(true);
      expect(Math.abs(ride.lean)).toBeLessThan(1);
      expect(ride.recoveries).toBe(0);
      expect(errors).toEqual([]);
    });
  }

  test('a vehicle can be reset somewhere valid, upright and at rest', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const reset = await page.evaluate(async ([sx, sz]) => {
      const t = window.__LH_TEST__!;
      const id = await t.spawnVehicle('van', sx as number, sz as number, 0)!;
      t.settle(90);
      t.setVehicleInput(id!, { throttle: 1 });
      t.settle(150);
      const moving = t.getVehicle(id!)!;

      t.setVehicleInput(id!, {});
      t.resetVehicle(id!, sx as number, moving.y, (sz as number) - 5, Math.PI / 2);
      t.settle(60);
      const after = t.getVehicle(id!)!;
      t.despawnVehicle(id!);
      return { movingSpeed: moving.forwardSpeed, after };
    }, [START.x, START.z] as const);

    expect(reset.movingSpeed).toBeGreaterThan(1);
    expect(Math.abs(reset.after.forwardSpeed)).toBeLessThan(1.5);
    expect(reset.after.upright).toBe(true);
    expect(errors).toEqual([]);
  });

  test('despawning leaves no bodies behind', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const counts = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.initPhysics();
      const before = t.getPhysics().bodies;

      const ids: string[] = [];
      for (const k of ['hatchback', 'bicycle', 'van']) {
        const id = await t.spawnVehicle(k, 0, 30 + ids.length * 6, 0);
        if (id) ids.push(id);
      }
      t.settle(30);
      const during = t.getPhysics().bodies;

      for (const id of ids) t.despawnVehicle(id);
      t.settle(30);
      return { before, during, after: t.getPhysics().bodies };
    });

    expect(counts.during).toBe(counts.before + 3);
    expect(counts.after).toBe(counts.before);
    expect(errors).toEqual([]);
  });
});
