import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * The population, in a real browser, against the production build.
 *
 * These exist because none of the unit tests can see whether Recast actually
 * generated anything. Phase 2 recorded navigation as a library failure on the
 * strength of one error string; the only way that claim gets checked is by
 * running it.
 */

function watchConsole(page: Page): { errors: string[]; warnings: string[] } {
  const errors: string[] = [];
  const warnings: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
    if (m.type() === 'warning') warnings.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return { errors, warnings };
}

async function boot(page: Page) {
  // `domcontentloaded`, not the default `load`.
  //
  // Waiting for `load` waits for every asset the page will ever fetch, and one
  // of them is now ~900 kB of Recast WebAssembly pulled in behind the world.
  // On a machine already running a browser flat out for forty minutes that
  // occasionally outran even a 180-second budget, and the failure surfaced as
  // `page.goto` timing out — which reads like the server is down rather than
  // like the page is busy. The bridge appearing is the real readiness signal
  // and it is waited for on the next line.
  await page.goto('/?e2e=1', { waitUntil: 'domcontentloaded', timeout: 60_000 });
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
  // The population is deliberately late: it carries that WebAssembly and loads
  // after the world is standing.
  return page.evaluate(() => window.__LH_TEST__!.awaitPopulation());
}

/**
 * A settle budget, learned the hard way.
 *
 * The first version of this spec ran 2,400-frame loops. Headless Chromium was
 * then simulating a frame in about 40 ms — the camera's whole-scene occluder
 * raycast, since fixed — which made that 96 seconds inside one `page.evaluate`
 * against a 90-second timeout. A test that dies inside a long evaluate leaves
 * the page wedged, so the *next* one fails on `page.goto` too; six of the
 * fourteen failures in that run were the cascade rather than anything to do
 * with NPCs.
 *
 * A frame is 3.7 ms now and the loops are shorter, but the lesson stands: keep
 * any single evaluate well under 1,500 frames, and give the file room.
 */
test.describe.configure({ timeout: 180_000 });

test.describe('population', () => {
  test('the village is inhabited, and the navmesh is real', async ({ page }) => {
    const { errors } = watchConsole(page);
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
    const { errors } = watchConsole(page);
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
      // Pick whoever currently has the furthest to go, rather than naming
      // somebody and hoping.
      //
      // Residents spawn where the clock says they already are, so at most
      // hours most of them are standing on their anchor with nothing to do.
      // The first version of this named Maryam, set the hour to 09:00, and
      // found her already at the stall — it measured 1.8 m of movement and
      // called the schedule broken.
      t.setNpcHour(20);
      t.settle(60);

      const gap = (n: { x: number; z: number; targetX: number | null; targetZ: number | null }) =>
        n.targetX === null || n.targetZ === null
          ? 0
          : Math.hypot(n.x - n.targetX, n.z - n.targetZ);

      const walker = t
        .getNpcs()
        .filter((n) => !n.indoors)
        .sort((a, b) => gap(b) - gap(a))[0]!;

      // Stand beside them: the near tier is where avoidance and animation are.
      t.teleport(walker.x + 4, walker.z + 4, 0);
      t.settle(30);

      const before = t.getNpc(walker.id)!;
      for (let i = 0; i < 10; i++) t.settle(90);
      const after = t.getNpc(walker.id)!;
      return { id: walker.id, before, after, gapBefore: gap(before) };
    });

    // 900 frames is 15 seconds, so about 16 m at a stroll. Assert closing the
    // gap rather than arriving — see the settle budget above.
    expect(walk.gapBefore).toBeGreaterThan(6);
    const gapAfter = Math.hypot(
      walk.after.x - (walk.after.targetX ?? walk.after.x),
      walk.after.z - (walk.after.targetZ ?? walk.after.z),
    );
    expect(gapAfter).toBeLessThan(walk.gapBefore - 4);
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
      for (let i = 0; i < 8; i++) t.settle(90);

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
      // 20:00 has most of `early_trade`, `office_day` and `retired` heading to
      // their social anchor from wherever the afternoon left them, so several
      // residents genuinely have somewhere to be.
      t.setNpcHour(20);
      t.teleport(0, 20, 0);
      t.settle(30);

      const gap = (n: { x: number; z: number; targetX: number | null; targetZ: number | null }) =>
        n.targetX === null || n.targetZ === null
          ? 0
          : Math.hypot(n.x - n.targetX, n.z - n.targetZ);

      // Only the ones with a real journey ahead of them. Somebody standing on
      // their anchor is not seized up, they have arrived — the first version
      // counted those as failures.
      const travelling = t.getNpcs().filter((n) => !n.indoors && gap(n) > 6);
      const start = travelling.map((n) => ({ id: n.id, gap: gap(n) }));

      for (let i = 0; i < 10; i++) t.settle(90);

      const end = start.map((s) => {
        const n = t.getNpc(s.id)!;
        return { id: s.id, gap: gap(n) };
      });
      return { start, end, pop: t.getPopulation()! };
    });

    expect(seen.start.length).toBeGreaterThanOrEqual(2);
    const closed = seen.start.filter((s, i) => seen.end[i].gap < s.gap - 3);
    // Everybody with somewhere to be got closer to it.
    expect(closed.length).toBe(seen.start.length);
  });

  test('standing in somebody\'s way does not stop them getting there', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const blocked = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Send a resident on a long walk, then stand on the line they are
      // walking. The crowd should steer round; the player is a solid obstacle
      // to it, not a suggestion.
      t.setNpcHour(13);
      t.settle(60);
      const npc = t.getNpcs().find((n) => !n.indoors)!;
      // 14 m, which is about 13 seconds at a stroll, against the 900 frames
      // below. Long enough to need the detour, short enough to finish inside
      // the settle budget.
      const goal = { x: npc.x + 14, z: npc.z };
      t.sendNpc(npc.id, goal.x, goal.z);

      // Halfway along, directly in the path.
      t.teleport(npc.x + 7, npc.z, Math.PI);
      t.settle(60);

      let closest = Infinity;
      for (let i = 0; i < 15; i++) {
        t.settle(60);
        const now = t.getNpc(npc.id)!;
        const player = t.getPlayerState();
        closest = Math.min(closest, Math.hypot(now.x - player.x, now.z - player.z));
      }

      const end = t.getNpc(npc.id)!;
      return {
        id: npc.id,
        toGoal: Math.hypot(end.x - goal.x, end.z - goal.z),
        closest,
        recoveries: t.getPopulation()!.stuckRecoveries,
      };
    });

    // They got past. Either steered around or, at worst, the watchdog freed
    // them — what must not happen is standing against the player forever.
    expect(blocked.toGoal).toBeLessThan(6);
    expect(errors).toEqual([]);
  });

  test('traffic runs and does not deadlock', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const traffic = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // On the road, so the bubble has somewhere to spawn.
      t.teleport(0, 0, 0);
      for (let i = 0; i < 12; i++) t.settle(60);
      const mid = t.getPopulation()!;
      const positions = t.getTraffic().map((v) => ({ x: v.x, z: v.z }));

      for (let i = 0; i < 12; i++) t.settle(60);
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

      for (let i = 0; i < 30; i++) {
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

  test('distance gates what a witness notices', async ({ page }) => {
    await boot(page);

    const result = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      t.settle(60);
      const target = t.getNpcs().find((n) => !n.indoors)!;
      t.teleport(target.x + 2, target.z + 2, 0);
      t.settle(60);

      // Two identical windows, differing only in where the event happens.
      //
      // `witnessed` is a running total of *everything*, including the greeting
      // the player emits every 1.5 s just by standing near people. An earlier
      // version compared the raw count before and after and asserted equality;
      // it went 3 to 23 and read like a wall failing to block anything, when
      // what it had measured was a conversation. The background is also not
      // constant between windows — people walk in and out of the near tier —
      // so the comparison has to be near-against-far, not against a fixed
      // number. Occlusion itself is covered exhaustively in the unit tests,
      // where the raycast answer can be supplied directly.
      const run = (offsetZ: number) => {
        const from = t.getPopulation()!.witnessed;
        for (let i = 0; i < 10; i++) {
          t.emitPerception('theft', target.x, target.y + 1, target.z + offsetZ);
          t.settle(40);
        }
        return t.getPopulation()!.witnessed - from;
      };

      // Far first, so the near run cannot be credited with its warm-up.
      const far = run(400);
      const near = run(0);
      return { far, near };
    });

    // A silent theft under somebody's nose is noticed; the same thing 400 m
    // away, outside the zone entirely, is not. Measured at roughly 3:1 against
    // the ambient background, so the margin is generous rather than tight.
    expect(result.near).toBeGreaterThan(result.far * 1.5);
  });

  test('relationships and ages survive a save and reload', async ({ page }) => {
    await boot(page);

    const round = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const target = t.getNpcs()[0];
      // Build some history.
      t.setNpcHour(13);
      t.teleport(target.x + 1.5, target.z + 1.5, 0);
      for (let i = 0; i < 8; i++) t.settle(60);

      const before = t.getRelationship(target.id)!;
      const ageBefore = t.getNpc(target.id)!.age;
      await t.forceBirthday();
      const ageAfterBirthday = t.getNpc(target.id)!.age;

      await t.saveNow('slot1');
      // Move the relationship somewhere else entirely, then load it back.
      for (let i = 0; i < 8; i++) t.settle(60);
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
    const { errors } = watchConsole(page);
    await boot(page);

    const trip = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const home = t.getPopulation()!;

      // City access is gated on age *and* the departure chapter. Without both
      // the journey is refused, and the test would then be asserting on the
      // village's population while believing it was the district's.
      t.completeChapter('village_departure');
      for (let i = 0; i < 4; i++) await t.forceBirthday();

      const went = await t.travelTo('city_old_market');
      const away = await t.awaitPopulation();

      await t.travelTo('village_coast');
      const back = await t.awaitPopulation();
      return { went, home, away, back };
    });

    expect(trip.went).toBe(true);
    // The districts have their own residents.
    expect(trip.away.named).toBe(5);
    expect(trip.away.navState).toBe('ready');
    // Coming home rebuilds the village population rather than accumulating.
    expect(trip.back.named).toBe(8);
    expect(trip.back.navAgents).toBeLessThanOrEqual(trip.home.navAgents + 4);
    expect(errors).toEqual([]);
  });

  test('a car driven through the village does not disturb anybody into an error', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const drive = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Driven by throttle rather than by getting in, the way `driving.spec`
      // does it. While the player is seated, `updateRiding` writes the vehicle
      // input from the real controls every frame and overwrites anything the
      // bridge sets — so an "entered" car in a test simply sits there. Riding
      // itself is covered in `driving.spec`; what this needs is a fast vehicle
      // moving among pedestrians.
      t.teleport(2, -34, 0);
      const id = await t.spawnVehicle('hatchback', 0, -30, 0);
      if (!id) return null;
      t.settle(60);
      t.setVehicleInput(id, { throttle: 1 });
      // Five seconds, not twenty. Held at full throttle for twenty it reaches
      // top speed, drives clean out of the village and gets caught by the
      // physics floor rescue — which teleports it upright *and at rest*, so
      // the first version of this measured 0.0005 m/s and concluded the car
      // had never moved.
      for (let i = 0; i < 5; i++) t.settle(60);
      const telemetry = t.getVehicle(id);
      const pop = t.getPopulation()!;
      t.despawnVehicle(id);
      return { id, speed: telemetry?.forwardSpeed ?? 0, pop };
    });

    expect(drive).not.toBeNull();
    // It actually drove, so the pedestrians had something to be near rather
    // than the test asserting on a parked car. Five seconds of throttle takes
    // a hatchback past 15 m/s.
    expect(Math.abs(drive!.speed)).toBeGreaterThan(8);
    expect(drive!.pop.named).toBe(8);
    expect(errors).toEqual([]);
  });

  test('the shipped build has one three.js, and no console errors at all', async ({ page }) => {
    // Attached before the navigation in `boot`, so the duplicate-three.js
    // warning — which fires while the modules evaluate — is catchable at all.
    const { errors, warnings } = watchConsole(page);
    await boot(page);

    await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(0, 0, 0);
      for (let i = 0; i < 8; i++) t.settle(60);
    });

    // `dedupe: ['three']` in the Vite config exists for this; a second copy
    // breaks instanceof and any prototype patching, which is how
    // `three-mesh-bvh` accelerates raycasts.
    expect(warnings.filter((w) => w.includes('Multiple instances of Three.js'))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
