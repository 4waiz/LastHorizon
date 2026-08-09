import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * The population, in a real browser, against the production build.
 *
 * These exist because none of the unit tests can see whether Recast actually
 * generated anything. Phase 2 recorded navigation as a library failure on the
 * strength of one error string; the only way that claim gets checked is by
 * running it.
 *
 * **Scenarios are grouped, several to a test.** That is not tidiness, it is the
 * only version of this file that finishes. Sixteen scenarios meant sixteen
 * pages, each with its own WebGL context and its own fetch of ~900 kB of
 * WebAssembly, and late in a suite that already boots sixty-odd pages
 * `page.goto` starts timing out at sixty seconds — the *load*, not the game,
 * which passed every assertion it reached. Sharing one page across the file
 * was tried and was worse: state accumulated and the file went from ten
 * minutes to twenty-two.
 *
 * Eight boots, then, each one self-contained. The cost is that a failure names
 * a group rather than a line, which is what the comments and the distinct
 * messages are for.
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
  // of them is ~900 kB of Recast WebAssembly pulled in behind the world. The
  // bridge appearing is the real readiness signal, and it is waited for on the
  // next line.
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
 * the page wedged, so the *next* one fails on `page.goto` too.
 *
 * A frame is 3.7 ms now and the loops are shorter, but the lesson stands: keep
 * any single evaluate well under 1,500 frames, and give the file room.
 */
test.describe.configure({ timeout: 180_000 });

test.describe('population', () => {
  test('the village is inhabited, the navmesh is real, and nobody floats', async ({ page }) => {
    const { errors } = watchConsole(page);
    const pop = await boot(page);

    // --- the navmesh exists at all, which is the claim Phase 2 got wrong ---
    expect(pop.named).toBe(8);
    expect(pop.navState).toBe('ready');
    expect(pop.navBuildMs).toBeGreaterThan(0);
    expect(pop.navBuildMs).toBeLessThan(3000);
    // One interior door plus two crossings.
    expect(pop.offMeshLinks).toBe(3);
    expect(pop.ambient).toBeGreaterThan(0);

    // --- crowd agents are taken and given back with distance ---
    const bands = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(-6, 46, 0);
      t.settle(120);
      const close = t.getPopulation()!;

      // The far corner of the zone, well beyond the mid band.
      t.teleport(110, -110, 0);
      t.settle(180);
      return { close, away: t.getPopulation()! };
    });

    expect(bands.close.near).toBeGreaterThan(0);
    expect(bands.close.navAgents).toBeGreaterThan(0);
    // A crowd agent left behind is a WASM allocation nothing will ever free.
    expect(bands.away.navAgents).toBeLessThan(bands.close.navAgents);
    expect(bands.away.far).toBeGreaterThan(0);

    // --- and everybody is standing on the ground ---
    const offGround = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(0, 20, 0);
      t.settle(240);
      return t
        .getNpcs()
        .filter((n) => !n.indoors)
        .map((n) => ({ id: n.id, dy: n.y - t.getGround(n.x, n.z) }))
        .filter((n) => Math.abs(n.dy) > 2.5);
    });
    // Roofs are out of the navmesh; without that, residents path onto houses
    // and stand five metres up.
    expect(offGround).toEqual([]);

    expect(errors).toEqual([]);
  });

  test('residents keep a routine and walk to it', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    // --- the shape of one resident's day ---
    const day = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const at = (hour: number) => {
        t.setNpcHour(hour);
        t.settle(30);
        const n = t.getNpc('v_maryam')!;
        return { hour, activity: n.activity, indoors: n.indoors };
      };
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

    // --- and everybody with somewhere to be gets closer to it ---
    const walk = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const gap = (n: { x: number; z: number; targetX: number | null; targetZ: number | null }) =>
        n.targetX === null || n.targetZ === null
          ? 0
          : Math.hypot(n.x - n.targetX, n.z - n.targetZ);

      // 20:00 sends most routines to their social anchor from wherever the
      // afternoon left them. Residents spawn where the clock says they already
      // are, so at most other hours they are standing on their anchor with
      // nothing to do — the first version of this named one resident, set
      // 09:00, found her already at the stall, and called the schedule broken.
      t.setNpcHour(20);
      t.teleport(0, 20, 0);
      t.settle(60);

      const travelling = t.getNpcs().filter((n) => !n.indoors && gap(n) > 6);
      const start = travelling.map((n) => ({ id: n.id, gap: gap(n) }));

      // 900 frames is 15 seconds, about 16 m at a stroll. Closing the gap, not
      // arriving — see the settle budget above.
      for (let i = 0; i < 10; i++) t.settle(90);

      return {
        start,
        end: start.map((s) => ({ id: s.id, gap: gap(t.getNpc(s.id)!) })),
      };
    });

    expect(walk.start.length).toBeGreaterThanOrEqual(2);
    const closed = walk.start.filter((s, i) => walk.end[i].gap < s.gap - 3);
    expect(closed.length).toBe(walk.start.length);

    expect(errors).toEqual([]);
  });

  test('nobody is walked into a wall, or stopped by somebody standing in the way', async ({
    page,
  }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    // --- sent somewhere unreachable, they stay outside it ---
    const wall = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      const npc = t.getNpcs().find((n) => !n.indoors)!;
      t.teleport(npc.x + 3, npc.z + 3, 0);
      t.settle(60);

      // The middle of a building footprint. HouseLarge sits at (-15.8, 62)
      // with a 3.4 x 4.2 collider, so this is solid geometry — and a hollow
      // box to Recast, which is why it has an unreachable navmesh island in it.
      t.sendNpc(npc.id, -15.8, 62);
      for (let i = 0; i < 8; i++) t.settle(90);
      const now = t.getNpc(npc.id)!;
      return { x: now.x, z: now.z };
    });

    expect(Math.abs(wall.x + 15.8) < 3.4 && Math.abs(wall.z - 62) < 4.2).toBe(false);

    // --- standing in their path does not stop them arriving ---
    const blocked = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      t.settle(60);
      const npc = t.getNpcs().find((n) => !n.indoors)!;
      // 14 m, about 13 seconds at a stroll, against the 900 frames below.
      const goal = { x: npc.x + 14, z: npc.z };
      t.sendNpc(npc.id, goal.x, goal.z);

      // Halfway along, directly in the way.
      t.teleport(npc.x + 7, npc.z, Math.PI);
      t.settle(60);
      for (let i = 0; i < 15; i++) t.settle(60);

      const end = t.getNpc(npc.id)!;
      return { toGoal: Math.hypot(end.x - goal.x, end.z - goal.z) };
    });

    // Steered around, or freed by the watchdog. What must not happen is a
    // resident pressed against the player forever.
    expect(blocked.toGoal).toBeLessThan(6);
    expect(errors).toEqual([]);
  });

  test('traffic runs, does not deadlock, and never appears in front of you', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const traffic = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      // On the road, so the bubble has somewhere to spawn.
      t.teleport(0, 0, 0);
      for (let i = 0; i < 12; i++) t.settle(60);
      const mid = t.getPopulation()!;
      for (let i = 0; i < 12; i++) t.settle(60);

      // Where each car is *first* seen, watching from a fixed spot up the road.
      //
      // Tracked by id. The first version keyed on rounded position, which
      // counts a car driving toward you as a new one every eight metres and
      // then reports it as having appeared under your nose — it failed at
      // 14.5 m for exactly that reason, with nothing wrong in the spawner.
      t.teleport(0, -30, 0); // facing +Z
      const firstSeen: Array<{ distance: number; bearing: number }> = [];
      const known = new Set<number>();
      const player = t.getPlayerState();

      for (let i = 0; i < 30; i++) {
        t.settle(30);
        for (const v of t.getTraffic()) {
          if (known.has(v.id)) continue;
          known.add(v.id);
          firstSeen.push({
            distance: Math.hypot(v.x - player.x, v.z - player.z),
            bearing: Math.atan2(v.x - player.x, v.z - player.z),
          });
        }
      }

      return { mid, seen: firstSeen, barges: t.getPopulation()!.trafficBarges };
    });

    expect(traffic.mid.traffic).toBeGreaterThan(0);
    // The watchdog exists; under ordinary conditions it should stay asleep.
    // A red light excuses the whole queue behind it, not only the front car.
    expect(traffic.barges).toBeLessThan(3);

    // No car may be first seen inside the forward cone at close range. One
    // already tracked that then drives into view is fine, and is not counted
    // here — that is what the id is for. `canSpawnAt` refuses anything nearer
    // than 45 m, so 20 m is a generous floor.
    expect(traffic.seen.length).toBeGreaterThan(0);
    for (const v of traffic.seen) {
      if (Math.abs(v.bearing) < (75 * Math.PI) / 180) {
        expect(v.distance).toBeGreaterThan(20);
      }
    }
    expect(errors).toEqual([]);
  });

  test('what a witness notices depends on how far away it happened', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setNpcHour(13);
      t.settle(60);
      const target = t.getNpcs().find((n) => !n.indoors)!;
      t.teleport(target.x + 1.5, target.z + 1.5, 0);
      t.settle(60);

      const relBefore = t.getRelationship(target.id)!;

      // Two identical windows, differing only in where the event happens.
      //
      // `witnessed` is a running total of *everything*, including the greeting
      // the player emits every 1.5 s just by standing near people. An earlier
      // version compared the raw count before and after and asserted equality;
      // it went 3 to 23 and read like a wall failing to block anything, when
      // what it had measured was a conversation. Occlusion itself is covered
      // exhaustively in the unit tests, where the raycast answer is supplied
      // directly.
      const run = (kind: string, offsetZ: number) => {
        const from = t.getPopulation()!.witnessed;
        for (let i = 0; i < 10; i++) {
          t.emitPerception(kind, target.x, target.y + 1, target.z + offsetZ);
          t.settle(40);
        }
        return t.getPopulation()!.witnessed - from;
      };

      // Far first, so the near run cannot be credited with its warm-up.
      const far = run('theft', 400);
      const near = run('theft', 0);
      run('collision', 0);

      return { far, near, relBefore, relAfter: t.getRelationship(target.id)! };
    });

    // A silent theft under somebody's nose is noticed; the same thing 400 m
    // away, outside the zone entirely, is not. Roughly 3:1 in practice.
    expect(seen.near).toBeGreaterThan(seen.far * 1.5);
    // And standing next to somebody makes you a familiar face.
    expect(seen.relAfter.familiarity).toBeGreaterThan(seen.relBefore.familiarity);
    expect(errors).toEqual([]);
  });

  test('relationships and ages survive a birthday, a save and a reload', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const round = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const target = t.getNpcs()[0];
      t.setNpcHour(13);
      t.teleport(target.x + 1.5, target.z + 1.5, 0);
      for (let i = 0; i < 8; i++) t.settle(60);

      const before = t.getRelationship(target.id)!;
      const ageBefore = t.getNpc(target.id)!.age;
      await t.forceBirthday();
      const ageAfterBirthday = t.getNpc(target.id)!.age;

      await t.saveNow('slot1');
      // Move things on, then load it back.
      for (let i = 0; i < 8; i++) t.settle(60);
      await t.loadNow('slot1');

      return {
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
    expect(errors).toEqual([]);
  });

  test('leaving the zone and coming back gives everything up and rebuilds it', async ({ page }) => {
    const { errors } = watchConsole(page);
    await boot(page);

    const trip = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const home = t.getPopulation()!;

      // City access is gated on age *and* the departure chapter. Without both
      // the journey is refused, and the test would then assert on the village's
      // population while believing it was the district's.
      t.completeChapter('village_departure');
      for (let i = 0; i < 4; i++) await t.forceBirthday();

      const went = await t.travelTo('city_old_market');
      const away = await t.awaitPopulation();

      await t.travelTo('village_coast');
      const back = await t.awaitPopulation();
      return { went, home, away, back };
    });

    expect(trip.went).toBe(true);
    // The districts have their own residents, and their own navmesh.
    expect(trip.away.named).toBe(5);
    expect(trip.away.navState).toBe('ready');
    // Coming home rebuilds rather than accumulating.
    expect(trip.back.named).toBe(8);
    expect(trip.back.navAgents).toBeLessThanOrEqual(trip.home.navAgents + 4);
    expect(errors).toEqual([]);
  });

  test('a car driven through the village disturbs nobody, and there is one three.js', async ({
    page,
  }) => {
    // Attached before the navigation in `boot`, so the duplicate-three.js
    // warning — which fires while the modules evaluate — is catchable at all.
    const { errors, warnings } = watchConsole(page);
    await boot(page);

    const drive = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Driven by throttle rather than by getting in, the way `driving.spec`
      // does it. While the player is seated, `updateRiding` writes the vehicle
      // input from the real controls every frame and overwrites anything the
      // bridge sets, so an "entered" car in a test simply sits there. Riding is
      // covered in `driving.spec`; what this needs is a fast vehicle among
      // pedestrians.
      t.teleport(2, -34, 0);
      const id = await t.spawnVehicle('hatchback', 0, -30, 0);
      if (!id) return null;
      t.settle(60);
      t.setVehicleInput(id, { throttle: 1 });
      // Five seconds, not twenty. Held at full throttle for twenty it reaches
      // top speed, leaves the village and is caught by the physics floor
      // rescue — which teleports it upright *and at rest*, so an earlier
      // version measured 0.0005 m/s and concluded the car had never moved.
      for (let i = 0; i < 5; i++) t.settle(60);
      const telemetry = t.getVehicle(id);
      const pop = t.getPopulation()!;
      t.despawnVehicle(id);
      return { speed: telemetry?.forwardSpeed ?? 0, pop };
    });

    expect(drive).not.toBeNull();
    // It actually drove: five seconds of throttle takes a hatchback past 15 m/s.
    expect(Math.abs(drive!.speed)).toBeGreaterThan(8);
    expect(drive!.pop.named).toBe(8);

    // `dedupe: ['three']` in the Vite config exists for this; a second copy
    // breaks instanceof and any prototype patching, which is how
    // `three-mesh-bvh` accelerates raycasts.
    expect(warnings.filter((w) => w.includes('Multiple instances of Three.js'))).toEqual([]);
    expect(errors).toEqual([]);
  });
});
