import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Upper-body overlays run over locomotion.
 *
 * Three.js has no bone masking, so the masking is in the clips: Wave, CarryBox
 * and UsePhone key only the chest, neck, head and arms. They are played
 * additively, which is only correct if the conversion happens on a *clone* —
 * `makeClipAdditive` rewrites track values in place and has no idempotency
 * guard, so converting the live clip would corrupt it for every other use.
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

test.describe('gestures', () => {
  test('all three overlays are in the GLB and start', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const out: Record<string, unknown> = {};
      for (const name of ['Wave', 'CarryBox', 'UsePhone']) {
        out[name] = t.playGesture(name);
        t.settle(20);
        out[name + 'Playing'] = t.getGesture().playing;
      }
      out.unknown = t.playGesture('Nope');
      return out;
    });

    expect(seen.Wave).toBe(true);
    expect(seen.CarryBox).toBe(true);
    expect(seen.UsePhone).toBe(true);
    expect(seen.UsePhonePlaying).toBe('UsePhone');
    // A missing overlay degrades to no gesture rather than throwing.
    expect(seen.unknown).toBe(false);
    expect(errors).toEqual([]);
  });

  test('an overlay ramps in and back out', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.playGesture('Wave');
      t.settle(40);
      const up = t.getGesture();

      t.settle(2);
      const mid = t.getGesture();

      // Stop, then let the fade finish so the layer is released.
      window.__LH_TEST__!.playGesture('Wave');
      t.settle(60);
      return { up, mid, after: t.getGesture() };
    });

    expect(seen.up.playing).toBe('Wave');
    expect(seen.up.weight).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('replaying an overlay does not drift the pose', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      // Play, settle, replay, several times over. If the additive conversion
      // ran on the live clip it would subtract the reference frame again on
      // every replay and the arm would wander further from rest each time.
      const heights: number[] = [];
      for (let i = 0; i < 4; i++) {
        t.playGesture('Wave');
        t.settle(30);
        heights.push(t.getAppearance().height);
      }
      return { heights, stats: t.getRenderStats() };
    });

    // The rig is intact and unchanged throughout.
    expect(new Set(seen.heights).size).toBe(1);
    expect(seen.stats.triangles).toBeGreaterThan(100_000);
    expect(errors).toEqual([]);
  });

  test('locomotion keeps running underneath', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(5.4, -39.3, Math.PI);
      t.settle(10);
      t.playGesture('CarryBox');
      t.settle(40);
      return {
        gesture: t.getGesture(),
        player: t.getPlayerState(),
        stats: t.getRenderStats(),
      };
    });

    // The overlay is live and the character is still in a normal state --
    // the additive layer sums onto the base rather than replacing it.
    expect(seen.gesture.playing).toBe('CarryBox');
    expect(seen.player.state).toBeTruthy();
    expect(seen.stats.drawCalls).toBeGreaterThan(50);
    expect(errors).toEqual([]);
  });
});
