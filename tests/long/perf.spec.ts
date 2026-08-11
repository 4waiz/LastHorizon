import { test, expect, type Page } from '@playwright/test';
import { writeFileSync, mkdirSync } from 'node:fs';

/**
 * Performance, held to the numbers in `docs/PERFORMANCE_BUDGETS.md`.
 *
 * Two honest caveats up front, because a performance test that overstates what
 * it measured is worse than none:
 *
 * 1. **This runs in headless Chromium, which has no GPU.** It rasterises in
 *    software. So the *frame rate* here is meaningless and is deliberately not
 *    asserted — Phase 6 spent most of a day learning that, when `settle(900)`
 *    turned out to be nine hundred software rasterisations of a 600 k-triangle
 *    scene and a spec went from 17.8 minutes to 1.4 by drawing one frame.
 * 2. **What it does measure is scene cost**, which is renderer-reported and
 *    hardware-independent: draw calls, triangles, programs, geometries,
 *    textures. Those are the numbers the budgets are written in, and a
 *    regression in them is real wherever it is measured.
 *
 * Frame timing on real hardware is a Chrome DevTools trace on a real machine,
 * recorded in the release report by hand. This file is the part that can run
 * unattended and block a merge.
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
}

/** The documented baseline vantage every outdoor figure was taken from. */
async function atBaselineVantage(page: Page, mode: 'day' | 'night'): Promise<void> {
  await page.evaluate((m) => {
    const t = window.__LH_TEST__!;
    t.setTimeMode(m);
    t.teleport(5.4, -39.3, Math.PI);
    t.frameCamera(Math.PI, 7);
    t.prepareShot();
    t.settle(120);
  }, mode);
}

interface Stats {
  drawCalls: number;
  triangles: number;
  programs: number;
  geometries: number;
  textures: number;
}

const stats = (page: Page): Promise<Stats> =>
  page.evaluate(() => {
    const s = window.__LH_TEST__!.getRenderStats();
    return {
      drawCalls: s.drawCalls,
      triangles: s.triangles,
      programs: s.programs,
      geometries: s.geometries,
      textures: s.textures,
    };
  });

/** Budgets, from docs/PERFORMANCE_BUDGETS.md. Raising one here means raising it there. */
const BUDGET = {
  drawCallsDay: 410,
  drawCallsNight: 500,
  trianglesOutdoor: 700_000,
  drawCallsInterior: 290,
  trianglesInterior: 880_000,
  programs: 70,
  geometries: 260,
  textures: 32,
  /**
   * The interior runs higher than the outdoor ceiling and always has —
   * measured at 38 in Phase 12, against an outdoor 29. The kit's nine hero
   * props carry their own maps and the portal target counts as one more.
   * Recorded here rather than left unmeasured: an unasserted number is a
   * number nobody notices doubling.
   */
  texturesInterior: 44,
} as const;

const report: Record<string, Stats> = {};

test.afterAll(() => {
  // A machine-readable artefact for CI to upload, so a regression can be
  // compared against the run before it rather than argued about.
  mkdirSync('perf-report', { recursive: true });
  writeFileSync('perf-report/scene-cost.json', JSON.stringify(report, null, 2));
});

test.describe('@perf', () => {
  test('village day is inside its draw-call and triangle budgets', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.awaitPopulation?.());
    await atBaselineVantage(page, 'day');

    const s = (report['village-day'] = await stats(page));

    expect(s.drawCalls).toBeLessThanOrEqual(BUDGET.drawCallsDay);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.trianglesOutdoor);
    expect(s.programs).toBeLessThanOrEqual(BUDGET.programs);
    expect(s.geometries).toBeLessThanOrEqual(BUDGET.geometries);
    expect(s.textures).toBeLessThanOrEqual(BUDGET.textures);
  });

  test('village night is inside the higher lamp-pool budget', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.awaitPopulation?.());
    await atBaselineVantage(page, 'night');

    const s = (report['village-night'] = await stats(page));

    // Night is the outdoor peak: the point light pool engages.
    expect(s.drawCalls).toBeLessThanOrEqual(BUDGET.drawCallsNight);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.trianglesOutdoor);
  });

  test('the interior worst case still fits, portal and all', async ({ page }) => {
    await boot(page);
    await atBaselineVantage(page, 'day');

    // A warm-up lap through both room kinds first. `renderer.info.programs`
    // counts what has *compiled*, so a cold first room reports a number that
    // is about nothing — the trap Phase 8 found in `interiorBudget.spec.ts`.
    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door_home = t.getDoors().find((d) => d.interiorId === 'home');
      if (door_home) await t.enterDoor(door_home.id);
      await t.exitInterior();
      const door_grocery = t.getDoors().find((d) => d.interiorId === 'grocery');
      if (door_grocery) await t.enterDoor(door_grocery.id);
      await t.exitInterior();
    });

    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // The family home: one of only two rooms that still render a live
      // window portal, which is what makes the interior the triangle worst
      // case rather than the cheapest scene in the game.
      const door_home = t.getDoors().find((d) => d.interiorId === 'home');
      if (door_home) await t.enterDoor(door_home.id);
      t.prepareShot();
      t.settle(90);
    });

    const s = (report['interior-home'] = await stats(page));

    expect(s.drawCalls).toBeLessThanOrEqual(BUDGET.drawCallsInterior);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.trianglesInterior);
    expect(s.programs).toBeLessThanOrEqual(BUDGET.programs);
    expect(s.textures).toBeLessThanOrEqual(BUDGET.texturesInterior);
  });

  test('a district is inside the outdoor budgets too', async ({ page }) => {
    await boot(page);

    // **The city is gated, and the first version of this test did not notice.**
    // Story Mode refuses `travelTo` before eighteen and before the departure
    // chapter, so the travel silently returned false, the run stayed in the
    // village, and the assertions passed against village numbers — byte
    // identical to the day test, which is what gave it away. A budget asserted
    // against a scene the test never reached is worse than no test.
    const arrived = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.completeChapter('village_departure');
      await t.advanceLife(3 * 3600);
      const ok = await t.travelTo('city_old_market');
      return { ok, zone: t.getActiveZone() };
    });

    expect(arrived.ok, 'travel to the district was refused').toBe(true);
    expect(arrived.zone).toBe('city_old_market');

    await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      t.frameCamera(Math.PI, 7);
      t.prepareShot();
      t.settle(120);
    });

    const s = (report['city-old-market'] = await stats(page));

    expect(s.drawCalls).toBeLessThanOrEqual(BUDGET.drawCallsDay);
    expect(s.triangles).toBeLessThanOrEqual(BUDGET.trianglesOutdoor);
  });

  test('the simulation step stays bounded with the population live', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.awaitPopulation?.());
    await atBaselineVantage(page, 'day');

    // `settle(n)` advances n fixed 1/60 s steps and renders only the last,
    // so this is very nearly pure simulation cost — which is the one timing
    // number headless Chromium, with no GPU, can report honestly.
    const msPerStep = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const N = 600;
      const start = performance.now();
      t.settle(N);
      return (performance.now() - start) / N;
    });

    report['sim-step'] = { drawCalls: 0, triangles: 0, programs: 0, geometries: 0, textures: 0 };
    // Generous against the ~0.15 ms the population itself costs (Phase 6,
    // measured), because this is software rendering on a shared CI runner and
    // the useful signal is "did this become tens of milliseconds".
    expect(msPerStep).toBeLessThan(12);
  });
});
