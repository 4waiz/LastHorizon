import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Soak: does the game give everything back?
 *
 * The rule this file is built on is from `docs/TEST_STRATEGY.md` and it has
 * been earned twice: **object counts beat heap size for leak detection.** Heap
 * is noisy because GC timing varies — the Phase 1 baseline recorded heap
 * *falling* over a 160-second run — while geometries, textures and programs
 * are exact, and a leak shows in them immediately.
 *
 * The second rule matters just as much: **compare lap two against lap one, not
 * lap one against the start.** The first interior entry *builds* the room, so a
 * test that allows "+4 over the starting count" is measuring lazy
 * initialisation and would go on failing however healthy the code was. That
 * exact mistake was made in Phase 5's smoke test and again in Phase 8's
 * interior budget spec.
 */

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on('console', (m: ConsoleMessage) => {
    if (m.type() === 'error') errors.push(m.text());
  });
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  return errors;
}

async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
}

interface Counts {
  geometries: number;
  textures: number;
  programs: number;
}

async function counts(page: Page): Promise<Counts> {
  return page.evaluate(() => {
    const s = window.__LH_TEST__!.getRenderStats();
    return { geometries: s.geometries, textures: s.textures, programs: s.programs };
  });
}

/**
 * What the crowd's two bounded caches hold on the GPU right now: a geometry
 * per appearance variant drawn, a bone texture per skeleton drawn. Counted
 * when drawn, not when built — a body is built by distance, not visibility,
 * so one behind the camera can wait a day for its first draw. See the walk.
 */
async function crowd(page: Page): Promise<{ geometries: number; textures: number }> {
  return page.evaluate(() => {
    const p = window.__LH_TEST__!.getPopulation();
    return { geometries: p?.drawnVariants ?? 0, textures: p?.boneTextures ?? 0 };
  });
}

/** One in-game day at the fixed 1/60 s step: `DAY_LENGTH_SECONDS` (300) in src/world/Environment.ts. */
const DAY_FRAMES = 300 * 60;

/**
 * Hold the residents and the traffic still and out of frame, for a
 * measurement about something else. The hold survives zone changes.
 */
async function holdPopulation(page: Page): Promise<void> {
  await page.evaluate(async () => {
    const t = window.__LH_TEST__!;
    await t.awaitPopulation();
    t.setPopulationActive(false);
  });
}

/**
 * Drive frames *and* yield to the event loop between them.
 *
 * Phase 9's lesson, and it is not optional here: a synchronous `for` loop
 * calling `step()` inside one `page.evaluate` never unwinds the JS stack, so no
 * timer fires, so anything awaiting a fade — a door, a save, a zone load —
 * never completes. The failure looks exactly like a missing feature.
 */
async function settleThrough(page: Page, frames: number, chunk = 30): Promise<void> {
  for (let done = 0; done < frames; done += chunk) {
    await page.evaluate((n) => window.__LH_TEST__!.settle(n), Math.min(chunk, frames - done));
    await page.waitForTimeout(0);
  }
}

test.describe('@soak', () => {
  test('twenty interior round trips allocate nothing after the first', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.setTimeMode('day'));

    // The rooms are the subject, so the population is held, as smoke.spec.ts
    // and interiorBudget.spec.ts hold it for the same reason. Live, it was
    // what this measured: cars and pedestrians spawn in over the first minute
    // and each new model is uploaded the first time it is drawn, so
    // geometries climbed for seven laps (184 to 221) and then sat at exactly
    // 221 for the other thirteen. Lazy initialisation one warm-up lap could
    // not cover — the mistake this file's header warns about, by a new route.
    await holdPopulation(page);

    // Lap one builds the room. It is not the measurement.
    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door_home = t.getDoors().find((d) => d.interiorId === 'home');
      if (door_home) await t.enterDoor(door_home.id);
      await t.exitInterior();
    });
    await settleThrough(page, 60);
    const afterWarmup = await counts(page);

    for (let i = 0; i < 20; i++) {
      await page.evaluate(async () => {
        const t = window.__LH_TEST__!;
        const door_home = t.getDoors().find((d) => d.interiorId === 'home');
      if (door_home) await t.enterDoor(door_home.id);
        await t.exitInterior();
      });
    }
    await settleThrough(page, 120);
    const after = await counts(page);

    // Exact, not approximate. Anything that grows here grows forever.
    expect(after.geometries).toBe(afterWarmup.geometries);
    expect(after.textures).toBe(afterWarmup.textures);
    // Programs are a compile cache, not an allocation, and the window is the
    // one way the outside can change while the crowd is held and the clock is
    // stopped. The home's portal re-renders the world into a render target,
    // which needs its own variant of every material it draws, and the clouds
    // and birds drift: the lap one first crosses the window compiles its
    // variant, once. Measured: 52 to 53 on the first measured lap — the cloud
    // material — then flat for the other nineteen. So at most one each for the
    // two moving materials. Programs duplicated per room would be twenty.
    expect(after.programs - afterWarmup.programs).toBeLessThanOrEqual(2);
    expect(errors).toEqual([]);
  });

  test('twenty village-city round trips return every tracked resource', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    // Held for the whole test; the hold survives each journey. Every arrival
    // builds a new population, and how much of it has been drawn by the
    // moment of reading depends on frame timing — so the two readings
    // compared two different crowds, not two villages. With the crowd held,
    // twenty laps read identically. What the crowd itself gives back on a
    // zone change is asserted exactly in tests/npcVisuals.test.ts.
    await holdPopulation(page);

    // The city is gated in Story Mode. Without this the travel is refused,
    // every lap is a no-op, and the leak test passes by never leaving home.
    const opened = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.completeChapter('village_departure');
      await t.advanceLife(3 * 3600);
      const ok = await t.travelTo('city_old_market');
      await t.travelTo('village_coast');
      return ok;
    });
    expect(opened, 'travel to the district was refused').toBe(true);
    await settleThrough(page, 120);
    const afterWarmup = await counts(page);

    for (let i = 0; i < 20; i++) {
      await page.evaluate(async () => {
        const t = window.__LH_TEST__!;
        await t.travelTo('city_old_market');
        await t.travelTo('village_coast');
      });
      await page.waitForTimeout(0);
    }
    await settleThrough(page, 180);

    const after = await counts(page);
    const zone = await page.evaluate(() => window.__LH_TEST__!.getZoneDebug());

    expect(await page.evaluate(() => window.__LH_TEST__!.getActiveZone())).toBe('village_coast');
    // Ownership, not bytes: the village is resident, so the district's chunks
    // and everything they registered must be gone.
    expect(zone.residentCount).toBeLessThanOrEqual(afterWarmup.geometries); // sanity, not a budget
    expect(after.geometries).toBeLessThanOrEqual(afterWarmup.geometries);
    expect(after.textures).toBe(afterWarmup.textures);
    expect(errors).toEqual([]);
  });

  test('a long walk does not drift the frame or the scene', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('cycle');
      t.teleport(5.4, -39.3, Math.PI);
    });
    await page.evaluate(() => window.__LH_TEST__!.awaitPopulation?.());

    // Lap one is a whole day, and it is not the measurement.
    //
    // The first time round, the lamp pool and its programs, every traffic
    // model and most of the wardrobe are drawn for the first time: 150
    // geometries became 224 over the first day, and none of it was a leak.
    // Measured from the morning, this test measured the morning.
    await settleThrough(page, DAY_FRAMES, 300);

    const first = await counts(page);
    const firstCrowd = await crowd(page);

    // Two more days with the clock running and the population live, in chunks
    // so timers and lazy loads can resolve.
    await settleThrough(page, 2 * DAY_FRAMES, 300);

    const last = await counts(page);
    const lastCrowd = await crowd(page);

    // Exactly two things may still grow, and both are bounded caches, named
    // here rather than allowed for as slack:
    //  - an appearance variant, the first time a pedestrian in a new
    //    combination of clothes is drawn: one geometry, shared by everyone
    //    who wears it, at most one per wardrobe combination (NpcVisuals);
    //  - a bone texture, the first time a body is drawn: one per skeleton,
    //    bounded by the body pool.
    // Each morning brings new pedestrians, so day two still meets new outfits.
    // Everything else on the GPU must be exactly where it was.
    expect(last.geometries - lastCrowd.geometries, 'geometry outside the crowd moved').toBe(
      first.geometries - firstCrowd.geometries,
    );
    expect(last.textures - lastCrowd.textures, 'a texture outside the crowd moved').toBe(
      first.textures - firstCrowd.textures,
    );
    // Programs may compile as the sun moves through the lamp pool; a small
    // rise is the shader cache warming, not a leak. A large one is neither.
    expect(last.programs - first.programs).toBeLessThanOrEqual(4);
    expect(errors).toEqual([]);
  });

  test('save and load fifty times without corrupting a slot', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const ok = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      let failures = 0;
      for (let i = 0; i < 50; i++) {
        if (!(await t.saveNow('slot1'))) failures++;
        if (!(await t.loadNow('slot1'))) failures++;
      }
      return failures;
    });

    expect(ok).toBe(0);
    expect(errors).toEqual([]);
  });
});
