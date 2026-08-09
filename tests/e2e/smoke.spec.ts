import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Production-build smoke tests.
 *
 * Everything is driven through `window.__LH_TEST__` rather than by poking the
 * DOM: ad-hoc capture is not reproducible, and during Phase 1 two apparent
 * "regressions" turned out to be nothing but different camera framing.
 */

/** Collect console errors for the whole test, so none slips past unnoticed. */
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

test.describe('Last Horizon smoke', () => {
  test('boots, renders the village and reports sane counters', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const stats = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      t.teleport(5.4, -39.3, Math.PI);
      t.prepareShot();
      return t.getRenderStats();
    });

    // Something is actually being drawn, and nothing has exploded the scene.
    expect(stats.drawCalls).toBeGreaterThan(50);
    expect(stats.drawCalls).toBeLessThan(430);
    expect(stats.triangles).toBeGreaterThan(100_000);
    expect(stats.triangles).toBeLessThan(560_000);
    expect(stats.programs).toBeLessThan(55);
    expect(errors).toEqual([]);
  });

  test('day and night both render, and night costs more draw calls', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const { day, night } = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(5.4, -39.3, Math.PI);
      t.setTimeMode('day');
      t.prepareShot();
      const day = t.getRenderStats();
      t.setTimeMode('night');
      t.settle(40);
      const night = t.getRenderStats();
      return { day, night };
    });

    // The lamp point-light pool engages after dark.
    expect(night.drawCalls).toBeGreaterThan(day.drawCalls);
    expect(errors).toEqual([]);
  });

  test('interior round trip preserves outdoor state and object counts', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    // The population must be here *and* held still before the first reading.
    // It is a separate chunk, so it lands after `ready()`; and a variant
    // geometry is built the first time somebody wears an appearance, so a
    // pedestrian arriving between the two laps looks exactly like a leak.
    await page.evaluate(() => window.__LH_TEST__!.awaitPopulation());

    const result = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setPopulationActive(false);
      t.setTimeMode('day');
      t.teleport(5.4, -39.3, Math.PI);
      t.prepareShot();
      const before = { state: t.getPlayerState(), stats: t.getRenderStats() };

      await t.enterInterior();
      t.settle(40);
      const inside = { state: t.getPlayerState(), stats: t.getRenderStats() };

      await t.exitInterior();
      t.settle(40);
      const after = { state: t.getPlayerState(), stats: t.getRenderStats() };

      // A second lap. The first one *builds* the interior cell -- 132 -> 156
      // geometries, once -- so comparing after-first against before-first
      // measures lazy initialisation, not accumulation. Two laps compared
      // against each other is the question actually worth asking.
      await t.enterInterior();
      t.settle(40);
      await t.exitInterior();
      t.settle(40);
      const twice = { state: t.getPlayerState(), stats: t.getRenderStats() };
      return { before, inside, after, twice };
    });

    expect(result.before.state.indoors).toBe(false);
    expect(result.inside.state.indoors).toBe(true);
    // The interior cell sits 600 m above the terrain.
    expect(result.inside.state.y).toBeGreaterThan(500);
    expect(result.after.state.indoors).toBe(false);

    // The window portal re-renders the outdoor world: interior is the heavy case.
    expect(result.inside.stats.triangles).toBeGreaterThan(result.before.stats.triangles);

    // Nothing accumulated: the second lap allocates nothing the first did not.
    expect(result.twice.stats.geometries).toBe(result.after.stats.geometries);
    expect(result.twice.stats.textures).toBe(result.after.stats.textures);
    // And the one-time build is bounded -- the interior is a room, not a zone.
    expect(result.after.stats.geometries).toBeLessThanOrEqual(
      result.before.stats.geometries + 40,
    );
    expect(errors).toEqual([]);
  });

  test('sit, wardrobe and lie all enter and exit cleanly', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const r = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      await t.enterInterior();
      t.settle(30);

      t.sit(true); t.settle(25);
      const sat = t.getPlayerState().sitting;
      t.sit(false); t.settle(20);
      const stood = t.getPlayerState().sitting;

      t.openWardrobe(true); t.settle(10);
      const wardrobeOpen = !document.getElementById('wardrobe')!.hidden;
      t.openWardrobe(false); t.settle(10);

      t.lie(true); t.settle(25);
      const lying = t.getPlayerState().lying;
      t.lie(false); t.settle(20);
      const upright = t.getPlayerState().lying;

      await t.exitInterior();
      t.settle(25);
      return { sat, stood, wardrobeOpen, lying, upright, indoors: t.getPlayerState().indoors };
    });

    expect(r.sat).toBe(true);
    expect(r.stood).toBe(false);
    expect(r.wardrobeOpen).toBe(true);
    expect(r.lying).toBe(true);
    expect(r.upright).toBe(false);
    expect(r.indoors).toBe(false);
    expect(errors).toEqual([]);
  });

  test('the test bridge is NOT installed without ?e2e=1', async ({ page }) => {
    await page.goto('/');
    await page.waitForTimeout(3000);
    const installed = await page.evaluate(() => typeof window.__LH_TEST__ !== 'undefined');
    expect(installed).toBe(false);
  });

  test('production build exposes no dev screenshot sink', async ({ page }) => {
    // `vite preview` answers every unknown path with index.html, so a 404 is
    // not available to assert on -- /anything-at-all returns 200 as well. What
    // the build must not do is *serve script* there. Absence of the sink from
    // dist itself is checked by scripts/check-budgets.mjs.
    const res = await page.request.get('/__cap.js');
    expect(res.headers()['content-type'] ?? '').toContain('text/html');
    const body = await res.text();
    expect(body).not.toContain('__shot');
    expect(body).not.toContain('lh-shot-sink');
  });
});
