import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';
import { proportionsForAge } from '../../src/player/AgeStages';

/**
 * Ageing changes the character on screen, without a reload.
 *
 * The proportion maths is unit-tested and so is writing it to a stand-in rig.
 * What neither can see is whether the values reach the *real* skeleton and
 * survive the animation mixer — `getAppearance` reads back off the live bones
 * rather than reporting what was asked for, which is the only version of this
 * assertion worth making.
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

test.describe('ageing', () => {
  test('the proportions reach the real rig', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.settle(10);
      return { appearance: t.getAppearance(), age: t.getLifeState().ageYears };
    });

    // The rig loaded, not the capsule fallback.
    expect(seen.appearance.bones).toBe(20);
    expect(seen.appearance.height).toBeGreaterThan(0.5);
    expect(seen.appearance.shoulderX).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });

  test('a birthday changes the body without a reload', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.settle(10);
      const before = { ...t.getAppearance(), age: t.getLifeState().ageYears };

      // Several birthdays, enough to cross a stage boundary.
      for (let i = 0; i < 6; i++) await t.forceBirthday();
      t.settle(20);

      const after = { ...t.getAppearance(), age: t.getLifeState().ageYears };
      return { before, after, stats: t.getRenderStats() };
    });

    // Actually aged, and the body followed.
    expect(seen.after.age).toBeGreaterThan(seen.before.age);
    expect(seen.after.bones).toBe(seen.before.bones);
    const changed =
      seen.after.height !== seen.before.height ||
      seen.after.head !== seen.before.head ||
      seen.after.limb !== seen.before.limb ||
      seen.after.shoulderX !== seen.before.shoulderX;
    expect(changed).toBe(true);

    // No reload, and the scene is still being drawn.
    expect(seen.stats.triangles).toBeGreaterThan(100_000);
    expect(errors).toEqual([]);
  });

  test('the stoop survives the animation mixer', async ({ page }) => {
    // Each birthday is a real-time sequence, and this needs ten of them to
    // reach a stage that stoops at all.
    test.setTimeout(240_000);
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      while (t.getLifeState().ageYears < 26) await t.forceBirthday();
      t.settle(60);
      const life = t.getLifeState();
      return { appearance: t.getAppearance(), age: life.ageYears + life.yearProgress };
    });

    // A stoop the mixer overwrote would read back as 0 -- it is re-applied
    // after the mixer every frame, which is the whole point of `update()`.
    expect(seen.appearance.stoop).toBeGreaterThan(0);
    expect(seen.appearance.stoop).toBeCloseTo(proportionsForAge(seen.age).stoop, 4);
    expect(errors).toEqual([]);
  });

  test('ageing does not break the skeleton or leak draw calls', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.teleport(5.4, -39.3, Math.PI);
      // Pin the time on both readings. Birthdays take real seconds, and the
      // sun keeps moving through them -- left free, the day/night cycle alone
      // shifts the counts and swamps what this is trying to measure.
      t.setTimeMode('day');
      t.setTime(0.35);
      t.prepareShot();
      const before = t.getRenderStats();

      for (let i = 0; i < 8; i++) await t.forceBirthday();
      t.setTime(0.35);
      t.prepareShot();
      const after = t.getRenderStats();
      return { before, after };
    });

    // A stage is proportions on one skeleton, not a mesh swap: nothing is
    // added to the scene, so the counts must not move. `programs` is the
    // sharpest of the three -- a per-stage material would show up here first.
    expect(seen.after.programs).toBe(seen.before.programs);
    expect(seen.after.drawCalls).toBe(seen.before.drawCalls);
    expect(seen.after.triangles).toBe(seen.before.triangles);
    expect(errors).toEqual([]);
  });
});
