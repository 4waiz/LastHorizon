import { test, expect, type Page } from '@playwright/test';

/**
 * Deterministic visual regression over the scenes a change is most likely to
 * break without breaking a counter.
 *
 * Phase 9 is the argument for this file existing. The aim camera's reticle sat
 * on the back of the character's head, and **nothing but looking at a
 * screenshot caught it** — the draw calls, triangles and program counts were
 * all exactly right, because the fault was where the camera pointed rather
 * than what it drew. `docs/TEST_STRATEGY.md` has listed "no visual-diff
 * assertion" as an open gap since Phase 1.
 *
 * Every shot goes through the same pinning: clock frozen, input released,
 * camera framed from a fixed vantage, and a settle so nothing is mid-build.
 * The tolerance is in `playwright.visual.config.ts` and it is deliberately
 * loose — clouds drift and birds fly, and that is documented rather than
 * pretended away.
 *
 * **On a first run these baselines do not exist**, and Playwright writes them
 * and fails, which is correct: a baseline nobody looked at is not a baseline.
 * Review the images in `tests/visual/scenes.spec.ts-snapshots/` before
 * committing them.
 */

async function boot(page: Page): Promise<void> {
  await page.goto('/?e2e=1');
  await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
    timeout: 60_000,
  });
  await page.evaluate(() => window.__LH_TEST__!.ready());
}

/**
 * Pin everything that moves, then let the scene settle.
 *
 * `releaseInput` first, and it is not optional: Phase 2 found that stale input
 * walks the player out of frame during capture, which produces a "regression"
 * that is really a held key.
 */
async function pin(page: Page, at: { x: number; z: number; facing: number }, time: number) {
  await page.evaluate(
    ({ at, time }) => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      t.setTime(time);
      t.teleport(at.x, at.z, at.facing);
      t.frameCamera(Math.PI, 7);
      t.prepareShot();
      t.settle(90);
    },
    { at, time },
  );
  // One extra frame after the settle, so the compositor has the final image.
  await page.waitForTimeout(120);
}

const canvas = (page: Page) => page.locator('#viewport');

test.describe('village', () => {
  test('day, from the documented baseline vantage', async ({ page }) => {
    await boot(page);
    // The vantage every performance figure in docs/PERFORMANCE_BUDGETS.md was
    // taken from: the village start spawn, facing back down the road.
    await pin(page, { x: 5.4, z: -39.3, facing: Math.PI }, 0.615);
    await expect(canvas(page)).toHaveScreenshot('village-day.png');
  });

  test('night, same framing, lamps lit', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.setTimeMode('night'));
    await pin(page, { x: 5.4, z: -39.3, facing: Math.PI }, 0.03);
    // Night is the outdoor peak for draw calls as the lamp pool engages, so a
    // regression in the light pool shows here and nowhere else.
    await expect(canvas(page)).toHaveScreenshot('village-night.png');
  });
});

test.describe('interiors', () => {
  test('the family home, assembled from the kit', async ({ page }) => {
    await boot(page);
    await pin(page, { x: 5.4, z: -39.3, facing: Math.PI }, 0.615);
    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door_home = t.getDoors().find((d) => d.interiorId === 'home');
      if (door_home) await t.enterDoor(door_home.id);
      // Re-frame *inside*. Going through a door moves the player 600 m up into
      // the interior cell, and without this the camera keeps its outdoor boom
      // and shoots the room from outside the wall, looking down through where
      // the ceiling would be. The first baseline was taken that way.
      t.frameCamera(0, 3.2, 0.15);
      t.prepareShot();
      t.settle(60);
    });
    await page.waitForTimeout(150);
    // What this guards is the *assembled room*: 30 kit parts on the 2 m grid,
    // their shared materials, and the two-light configuration Phase 7 found
    // doubles the program count when it is wrong.
    //
    // It does **not** guard the window portal, and the first version of this
    // comment claimed it did. A framing that shows the room does not contain a
    // window, and one that does would show little else. Portal coverage is the
    // triangle count in tests/long/perf.spec.ts — 525,886 against an 880,000
    // budget, which collapses to roughly 340,000 if the portal stops drawing.
    await expect(canvas(page)).toHaveScreenshot('interior-home.png');
  });

  test('the grocery, with ordinary toon panes', async ({ page }) => {
    await boot(page);
    await pin(page, { x: 5.4, z: -39.3, facing: Math.PI }, 0.615);
    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door_grocery = t.getDoors().find((d) => d.interiorId === 'grocery');
      if (door_grocery) await t.enterDoor(door_grocery.id);
      t.frameCamera(0, 3.2, 0.15);
      t.prepareShot();
      t.settle(60);
    });
    await page.waitForTimeout(150);
    await expect(canvas(page)).toHaveScreenshot('interior-grocery.png');
  });
});

test.describe('interface', () => {
  test('the loading screen, settled', async ({ page }) => {
    // Before `ready()`: this is the first thing anybody sees, and it is drawn
    // entirely from gradients and SVG so it paints before any asset loads.
    await page.goto('/?e2e=1');
    await page.waitForSelector('#startButton:not([hidden])', { timeout: 60_000 });
    await expect(page.locator('#loading')).toHaveScreenshot('loading.png');
  });

  test('the credits, where every licence claim lives', async ({ page }) => {
    await boot(page);
    await page.locator('#btnInfo').click();
    // The panel is lazy; wait for its content rather than a timeout.
    await page.waitForSelector('.credits', { state: 'visible', timeout: 20_000 });

    // Shoot the credits *section*, not the modal.
    //
    // The first baseline framed `#info .modal__card`, which opens scrolled to
    // the top — so it captured the objective and the controls list and none of
    // the licences, under a test named for them. That is the second time in
    // this file a shot did not contain the thing its name claimed, and both
    // were found by looking at the image rather than at the result.
    //
    // This is the one screen where a wrong pixel is a licensing statement:
    // GSAP is not open source, and the credits saying otherwise would be a
    // claim rather than a typo.
    const credits = page.locator('.credits');
    await credits.scrollIntoViewIfNeeded();
    await expect(credits).toHaveScreenshot('credits.png');
  });
});

test.describe('touch layout', () => {
  // `hasTouch`, not just a small viewport.
  //
  // `HUD.isTouch` reads `navigator.maxTouchPoints` **once, in the constructor**,
  // and hides the joystick and the action buttons when it is zero. Playwright's
  // Desktop Chrome reports no touch points, so the first baseline was a
  // 390 px-wide desktop layout with no on-screen controls in it at all — under
  // a test named "the on-screen controls at phone size".
  //
  // Because that check runs at construction, the emulation has to be set
  // before the page loads. `test.use` does that; `setViewportSize` mid-test
  // does not, which is what made the first attempt wrong.
  test.use({ hasTouch: true, isMobile: true, viewport: { width: 390, height: 844 } });

  test('the on-screen controls at phone size', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      t.prepareShot();
      t.settle(60);
    });
    await page.waitForTimeout(120);
    await expect(page).toHaveScreenshot('touch-portrait.png', { fullPage: false });
  });
});
