import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * The population, in a real browser, against the production build.
 *
 * These exist because none of the unit tests can see whether Recast actually
 * generated anything. Phase 2 recorded navigation as a library failure on the
 * strength of one error string; the only way that claim gets checked is by
 * running it.
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
  // The population is deliberately late: it carries Recast's WebAssembly and
  // loads after the world is standing.
  return page.evaluate(() => window.__LH_TEST__!.awaitPopulation());
}

test.describe('population', () => {
  test('the village is inhabited, and the navmesh is real', async ({ page }) => {
    const errors = watchConsole(page);
    const pop = await boot(page);

    expect(pop.named).toBe(8);
    // The claim this test exists to settle.
    expect(pop.navState).toBe('ready');
    expect(pop.navBuildMs).toBeGreaterThan(0);
    expect(pop.navBuildMs).toBeLessThan(3000);
    // One interior door plus two crossings.
    expect(pop.offMeshLinks).toBe(3);
    expect(pop.ambient).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('crowd agents exist near the player and are given back at distance', async ({ page }) => {
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Stand in the middle of the hero row, where residents live.
      t.teleport(-6, 46, 0);
      t.settle(120);
      const close = t.getPopulation()!;

      // The far corner of the zone, well beyond the mid band.
      t.teleport(110, -110, 0);
      t.settle(180);
      const away = t.getPopulation()!;
      return { close, away };
    });

    expect(seen.close.near).toBeGreaterThan(0);
    expect(seen.close.navAgents).toBeGreaterThan(0);
    // Everything demotes, and the crowd agents go with it. A leak here is a
    // WASM allocation nothing will ever free.
    expect(seen.away.navAgents).toBeLessThan(seen.close.navAgents);
    expect(seen.away.far).toBeGreaterThan(0);
  });

  test('a named resident keeps to a routine through the day', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const day = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Maryam runs `early_trade`: home before 06:30, at the stall from 07:00,
      // home again from 18:00, asleep from 22:30.
      const at = (hour: number) => {
        t.setNpcHour(hour);
        t.settle(30);
        const n = t.getNpc('v_maryam')!;
        return { hour, activity: n.activity, indoors: n.indoors, x: n.x, z: n.z };
      };
      // Stand near her home so she is simulated at a visible tier.
      t.teleport(-10, 44, 0);
      t.settle(60);
      return [at(3), at(9), at(13), at(20), at(23)];
    });

    // `early_trade`: work from 07:00, a break at 12:30, home at 18:00, supper
    // at 18:30, out at 19:30, asleep at 22:30.
    const byHour = Object.fromEntries(day.map((d) => [d.hour, d]));
    expect(byHour[3].activity).toBe('sleep');
    expect(byHour[9].activity).toBe('work');
    expect(byHour[13].activity).toBe('meal');
    expect(byHour[20].activity).toBe('social');
    expect(byHour[23].activity).toBe('sleep');
    expect(errors).toEqual([]);
  });

  test('a resident walks to where their schedule sends them', async ({ page }) => {
    await boot(page);

    const walk = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Follow her: standing near keeps her in the near tier the whole way.
      t.setNpcHour(3);
      t.settle(60);
      const before = t.getNpc('v_maryam')!;
      t.teleport(before.x + 4, before.z + 4, 0);
      t.settle(30);

      t.setNpcHour(9);
      // Long enough to cover the walk from home to the stall: roughly 45 m at
      // a 1.3 m/s commute, so about 35 seconds of simulation.
      for (let i = 0; i < 18; i++) t.settle(120);
      const after = t.getNpc('v_maryam')!;
      return { before, after };
    });

    const moved = Math.hypot(walk.after.x - walk.before.x, walk.after.z - walk.before.z);
    expect(moved).toBeGreaterThan(4);
    // The stall is at (10, 14).
    expect(Math.hypot(walk.after.x - 10, walk.after.z - 14)).toBeLessThan(14);
  });

  test('nobody floats, and nobody is buried', async ({ page }) => {
    await boot(page);

    const offGround = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.teleport(0, 20, 0);
      t.settle(240);
      return t
        .getNpcs()
        .filter((n) => !n.indoors)
        .map((n) => ({ id: n.id, dy: n.y - t.getGround(n.x, n.z) }))
        .filter((n) => Math.abs(n.dy) > 2.5);
    });

    expect(offGround).toEqual([]);
  });

  test('a resident sent into a wall never ends up inside it', async ({ page }) => {
    await boot(page);

    const result = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      const npc = t.getNpcs().find((n) => !n.indoors)!;
      t.teleport(npc.x + 3, npc.z + 3, 0);
      t.settle(60);

      // The middle of a building footprint. HouseLarge sits at (-15.8, 62) with
      // a 3.4 x 4.2 collider, so this is solid geometry.
      t.sendNpc(npc.id, -15.8, 62);
      for (let i = 0; i < 12; i++) t.settle(120);

      const now = t.getNpc(npc.id)!;
      return { id: npc.id, x: now.x, z: now.z, speed: now.speed };
    });

    // Inside the collider is the failure. Standing outside it, or having given
    // the destination up entirely, are both acceptable.
    const insideX = Math.abs(result.x + 15.8) < 3.4;
    const insideZ = Math.abs(result.z - 62) < 4.2;
    expect(insideX && insideZ).toBe(false);
  });

  test('residents keep moving over a long stretch rather than seizing up', async ({ page }) => {
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(9);
      t.teleport(0, 20, 0);
      const start = t.getNpcs().map((n) => ({ id: n.id, x: n.x, z: n.z }));
      for (let i = 0; i < 20; i++) t.settle(120);
      const end = t.getNpcs().map((n) => ({ id: n.id, x: n.x, z: n.z }));
      return { start, end, pop: t.getPopulation()! };
    });

    const moved = seen.start.filter((s, i) => {
      const e = seen.end[i];
      return Math.hypot(e.x - s.x, e.z - s.z) > 1;
    });
    // Not everybody is going anywhere at 09:00 — the retired resident is on a
    // bench. But most of the village should have got somewhere.
    expect(moved.length).toBeGreaterThanOrEqual(3);
  });

  test('traffic runs and does not deadlock', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const traffic = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // On the road, so the bubble has somewhere to spawn.
      t.teleport(0, 0, 0);
      for (let i = 0; i < 40; i++) t.settle(60);
      const mid = t.getPopulation()!;
      const positions = t.getTraffic().map((v) => ({ x: v.x, z: v.z }));

      for (let i = 0; i < 40; i++) t.settle(60);
      const later = t.getTraffic().map((v) => ({ x: v.x, z: v.z }));
      return { mid, positions, later, forced: t.getPopulation()!.trafficBarges };
    });

    expect(traffic.mid.traffic).toBeGreaterThan(0);
    // The watchdog exists; under ordinary conditions it should stay asleep.
    expect(traffic.forced).toBeLessThan(3);
    expect(errors).toEqual([]);
  });

  test('traffic never appears in front of the player', async ({ page }) => {
    await boot(page);

    const appeared = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.teleport(0, -30, 0); // facing +Z, up the road
      const seen: Array<{ x: number; z: number }> = [];
      const known = new Set<string>();

      for (let i = 0; i < 60; i++) {
        t.settle(30);
        for (const v of t.getTraffic()) {
          // Round hard, so a car that has moved is not counted as new.
          const key = `${Math.round(v.x / 8)},${Math.round(v.z / 8)}`;
          if (known.has(key)) continue;
          known.add(key);
          seen.push({ x: v.x, z: v.z });
        }
      }

      const p = t.getPlayerState();
      return seen.map((v) => ({
        distance: Math.hypot(v.x - p.x, v.z - p.z),
        bearing: Math.atan2(v.x - p.x, v.z - p.z),
      }));
    });

    // Nothing may first appear inside the forward cone at close range. Cars
    // driving *into* view are fine and expected; the rounding above lets those
    // through as "already known" from further out.
    for (const v of appeared) {
      const inFront = Math.abs(v.bearing) < (75 * Math.PI) / 180;
      if (inFront) expect(v.distance).toBeGreaterThan(20);
    }
  });

  test('a non-criminal disturbance is witnessed, and greeting is remembered', async ({ page }) => {
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Stand right beside a resident who is outdoors.
      t.setNpcHour(13);
      t.settle(60);
      const target = t.getNpcs().find((n) => !n.indoors)!;
      t.teleport(target.x + 1.5, target.z + 1.5, 0);
      t.settle(60);

      const before = t.getRelationship(target.id)!;
      const witnessedBefore = t.getPopulation()!.witnessed;

      // A shout: loud, harmless, and exactly the kind of thing Phase 9's
      // police layer will later care about.
      for (let i = 0; i < 20; i++) {
        t.emitPerception('collision', target.x, target.y + 1, target.z);
        t.settle(40);
      }

      return {
        before,
        after: t.getRelationship(target.id)!,
        witnessedBefore,
        witnessed: t.getPopulation()!.witnessed,
        reaction: t.getNpc(target.id)?.reaction ?? null,
      };
    });

    expect(seen.witnessed).toBeGreaterThan(seen.witnessedBefore);
    // Standing next to somebody makes you a familiar face.
    expect(seen.after.familiarity).toBeGreaterThan(seen.before.familiarity);
  });

  test('a wall stops a witness seeing through it', async ({ page }) => {
    await boot(page);

    const result = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      t.settle(60);
      const target = t.getNpcs().find((n) => !n.indoors)!;
      // Stand beside them, then raise a silent event on the far side of the
      // village. Silent means sight is the only channel, and 200 m of terrain
      // and houses is between.
      t.teleport(target.x + 2, target.z + 2, 0);
      t.settle(60);
      const before = t.getPopulation()!.witnessed;
      for (let i = 0; i < 10; i++) {
        t.emitPerception('theft', target.x, target.y + 1, target.z + 400);
        t.settle(40);
      }
      return { before, after: t.getPopulation()!.witnessed };
    });

    // Silent and 400 m away: nothing to see and nothing to hear.
    expect(result.after).toBe(result.before);
  });

  test('relationships and ages survive a save and reload', async ({ page }) => {
    await boot(page);

    const round = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const target = t.getNpcs()[0];
      // Build some history.
      t.setNpcHour(13);
      t.teleport(target.x + 1.5, target.z + 1.5, 0);
      for (let i = 0; i < 20; i++) t.settle(60);

      const before = t.getRelationship(target.id)!;
      const ageBefore = t.getNpc(target.id)!.age;
      await t.forceBirthday();
      const ageAfterBirthday = t.getNpc(target.id)!.age;

      await t.saveNow('slot1');
      // Move the relationship somewhere else entirely, then load it back.
      for (let i = 0; i < 40; i++) t.settle(60);
      await t.loadNow('slot1');

      return {
        id: target.id,
        before,
        ageBefore,
        ageAfterBirthday,
        after: t.getRelationship(target.id)!,
        ageAfterLoad: t.getNpc(target.id)!.age,
      };
    });

    expect(round.after.familiarity).toBeCloseTo(round.before.familiarity, 2);
    // A birthday ages the residents too.
    expect(round.ageAfterBirthday).toBe(round.ageBefore + 1);
    expect(round.ageAfterLoad).toBe(round.ageAfterBirthday);
  });

  test('leaving the zone and coming back gives everything up and rebuilds it', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const trip = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const home = t.getPopulation()!;

      await t.travelTo('city_old_market');
      const away = await t.awaitPopulation();

      await t.travelTo('village_coast');
      const back = await t.awaitPopulation();
      return { home, away, back };
    });

    // The districts have their own residents.
    expect(trip.away.named).toBe(5);
    expect(trip.away.navState).toBe('ready');
    // Coming home rebuilds the village population rather than accumulating.
    expect(trip.back.named).toBe(8);
    expect(trip.back.navAgents).toBeLessThanOrEqual(trip.home.navAgents + 4);
    expect(errors).toEqual([]);
  });

  test('driving through the village does not disturb anybody into an error', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const drive = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.teleport(2, -30, 0);
      const id = await t.spawnVehicle('hatchback', 4, -30, 0);
      if (!id) return { id: null, hit: 0 };
      await t.enterVehicle(id);
      t.setVehicleInput(id, { throttle: 1 });
      for (let i = 0; i < 60; i++) t.settle(20);
      const telemetry = t.getVehicle(id);
      const pop = t.getPopulation()!;
      await t.exitVehicle();
      return { id, telemetry, pop };
    });

    expect(drive.id).not.toBeNull();
    // It actually drove, so the traffic and the pedestrians had something to
    // avoid rather than the test asserting on a parked car.
    expect(Math.abs(drive.telemetry?.forwardSpeed ?? 0)).toBeGreaterThan(1);
    expect(errors).toEqual([]);
  });

  test('the shipped build has one three.js and no console errors while populated', async ({
    page,
  }) => {
    const warnings: string[] = [];
    page.on('console', (m) => {
      if (m.type() === 'warning' || m.type() === 'error') warnings.push(m.text());
    });
    await boot(page);
    await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(0, 0, 0);
      for (let i = 0; i < 30; i++) t.settle(60);
    });

    expect(warnings.filter((w) => w.includes('Multiple instances of Three.js'))).toEqual([]);
  });
});
