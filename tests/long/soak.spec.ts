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
    expect(after.programs).toBe(afterWarmup.programs);
    expect(errors).toEqual([]);
  });

  test('twenty village-city round trips return every tracked resource', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

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
    await settleThrough(page, 120);

    const first = await counts(page);

    // ~10 minutes of simulated play with the day/night cycle running and the
    // population live, in chunks so timers and lazy loads can resolve.
    await settleThrough(page, 36_000, 300);

    const last = await counts(page);

    expect(last.geometries).toBe(first.geometries);
    expect(last.textures).toBe(first.textures);
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
