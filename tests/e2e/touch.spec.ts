import { test, expect, devices, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Touch, on a phone-sized viewport with real touch events.
 *
 * Its own file because `test.use` with a device changes `defaultBrowserType`
 * and Playwright refuses that inside a `describe` — it forces a new worker.
 *
 * Nothing here uses the keyboard except to close a panel where that is the
 * point being tested. A tap is a tap: `locator.tap()` dispatches real touch
 * events, which is what separates this from resizing a desktop browser and
 * calling it mobile.
 */

/**
 * An iPhone 13, minus the browser switch.
 *
 * `devices['iPhone 13']` carries `defaultBrowserType: 'webkit'`, and that wins
 * over `--project=chromium` — so spreading the whole descriptor silently runs
 * this file under WebKit. It does not boot there in headless: every test
 * failed waiting for the test bridge with the loading screen frozen at 0%,
 * which reads exactly like a game bug and is not one. `deviceScaleFactor: 3`
 * and `isMobile: true` were both verified to boot fine on their own.
 *
 * Dropping `defaultBrowserType` keeps everything that makes this a phone —
 * the viewport, the user agent, DPR 3, `isMobile`, touch points — and leaves
 * the browser to the project. WebKit gets its own coverage from the full
 * three-project run.
 */
const { defaultBrowserType: _browser, ...iPhone13 } = devices['iPhone 13'];
test.use(iPhone13);

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

test.describe('touch', () => {

  test('shows on-screen controls and no desktop key hint', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    await expect(page.locator('#touch')).toBeVisible();
    await expect(page.locator('#stick')).toBeVisible();
    await expect(page.locator('#btnJump')).toBeVisible();
    // The keyboard hint is for keyboards. It is hidden outright on touch
    // rather than left saying "WASD to walk" at somebody with no W.
    await expect(page.locator('#hint')).toBeHidden();
    expect(errors).toEqual([]);
  });

  test('opens and closes a panel entirely by tapping', async ({ page }) => {
    await boot(page);

    // No keyboard anywhere in this test: the tile, then the close button.
    await page.locator('#btnInfo').tap();
    await expect(page.locator('#info')).toBeVisible({ timeout: 20_000 });
    await page.locator('#infoClose').tap();
    await expect(page.locator('#info')).toBeHidden();
  });

  test('a settings control can be operated by tap', async ({ page }) => {
    await boot(page);
    await page.locator('#btnInfo').tap();
    await expect(page.locator('#setUiScale')).toBeVisible({ timeout: 20_000 });

    await page.locator('#setUiScale button[data-scale="1.3"]').tap();
    await expect(page.locator('#setUiScale button[data-scale="1.3"]')).toHaveClass(/is-on/);

    const scale = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    );
    expect(parseFloat(scale)).toBeCloseTo(1.3, 2);
  });

  /**
   * The panels are the part most likely to break on a narrow viewport, and a
   * horizontal scrollbar on a phone is the classic way it shows.
   */
  test('no panel makes the page scroll sideways', async ({ page }) => {
    await boot(page);

    for (const open of [
      () => page.locator('#btnInfo').tap(),
      () => page.locator('#btnSound').tap(),
    ]) {
      await open();
      await page.waitForTimeout(600);
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      expect(overflow, 'the page scrolls sideways').toBeLessThanOrEqual(1);
      await page.keyboard.press('Escape');
      await page.waitForTimeout(300);
    }
  });

  test('the interface survives a rotation to landscape', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await page.setViewportSize({ width: 844, height: 390 });
    await page.waitForTimeout(500);

    await expect(page.locator('#touch')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    expect(overflow).toBeLessThanOrEqual(1);
    expect(errors).toEqual([]);
  });
});
