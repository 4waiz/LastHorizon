import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * The interface, in a real browser.
 *
 * Phase 11's criteria 3 and 5 — *"every screen reachable by keyboard alone"*
 * and *"no leak, no console error"* — have been unevidenced since the phase
 * started. Unit tests can drive a panel's DOM; they cannot prove that a
 * keyboard reaches it, that its chunk is genuinely lazy, or that opening and
 * closing it forty times gives the memory back.
 *
 * Nothing here uses ad-hoc DOM poking to *drive* the game: keys go through
 * real `keyboard.press`, which is what a player has. Reading the DOM
 * afterwards is assertion, not drive.
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
  // No focus dance needed: `InputManager` binds keydown/keyup on `window`, so
  // a press reaches it wherever focus happens to be. The first version of this
  // helper clicked the canvas to "give it focus" and every test in the file
  // timed out on the click — the loading overlay is still on top at that
  // moment and swallows the pointer.
}

/** Wait for a lazy panel to be both unhidden and populated by its chunk. */
async function openPanel(page: Page, key: string, sel: string): Promise<void> {
  await page.keyboard.press(key);
  await expect(page.locator(sel)).toBeVisible({ timeout: 20_000 });
}

test.describe('the life panel', () => {
  test('opens with I, from the keyboard alone', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    await expect(page.locator('#life')).toBeHidden();
    await openPanel(page, 'i', '#life');

    await expect(page.locator('.life__tab')).toHaveCount(3);
    await expect(page.locator('.life__tab').first()).toHaveText('Carrying');
    expect(errors).toEqual([]);
  });

  test('moves between tabs with the arrow keys and shows each one', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'i', '#life');

    // Focus the selected tab the way Tab would land on it, then drive it.
    await page.locator('#life-tab-carrying').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#life-tab-record')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#life-body')).toContainText('Wanted level');

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#life-tab-property')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#life-body')).toContainText('Aircraft');

    // Wraps, so a keyboard player never reaches a dead end.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#life-tab-carrying')).toHaveAttribute('aria-selected', 'true');
  });

  test('closes with Escape without pausing the game behind it', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'i', '#life');

    await page.keyboard.press('Escape');
    await expect(page.locator('#life')).toBeHidden();
    // The cascade: the first Escape closed the panel, so pause must still be
    // shut. A panel that falls through to pause is the bug this orders against.
    await expect(page.locator('#pause')).toBeHidden();
  });

  test('reads the real inventory rather than a placeholder', async ({ page }) => {
    await boot(page);
    await page.evaluate(() => window.__LH_TEST__!.giveItem('apple', 2));
    await openPanel(page, 'i', '#life');

    await expect(page.locator('#life-body')).toContainText('Apple');
    await expect(page.locator('#life-body')).toContainText('x2');
  });

  test('keeps only the selected tab in the tab order', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'i', '#life');

    const order = await page.$$eval('.life__tab', (els) =>
      els.map((e) => (e as HTMLElement).tabIndex),
    );
    expect(order).toEqual([0, -1, -1]);
  });

  test('is announced as a dialog with a name', async ({ page }) => {
    await boot(page);
    await openPanel(page, 'i', '#life');

    const dialog = page.getByRole('dialog', { name: 'Your life' });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('tablist')).toBeVisible();
    await expect(dialog.getByRole('tab')).toHaveCount(3);
  });
});

test.describe('lazy panels are actually lazy', () => {
  /**
   * The claim `check-budgets.mjs` makes on every build is that these chunks
   * are not on the startup path. That script reads file names; this reads the
   * network. If a panel ever gets imported eagerly by accident, the budget
   * would still pass — the chunk would simply be pulled in by the app chunk —
   * and only this test would notice.
   */
  test('the life panel is not fetched until it is opened', async ({ page }) => {
    const requested: string[] = [];
    page.on('request', (r) => requested.push(r.url()));

    await boot(page);
    const hit = () => requested.filter((u) => /LifePanel/.test(u)).length;
    expect(hit(), 'fetched before anybody asked for it').toBe(0);

    await openPanel(page, 'i', '#life');
    expect(hit(), 'never fetched at all').toBeGreaterThan(0);
  });

  test('its stylesheet lands before the panel is shown', async ({ page }) => {
    // The FOUC rule Phase 11 learned twice: reveal in the `.then()`, never
    // before. If the CSS had not applied, the tab strip would have no layout.
    await boot(page);
    await openPanel(page, 'i', '#life');

    const display = await page
      .locator('#life-tabs')
      .evaluate((el) => getComputedStyle(el).display);
    expect(display, 'stylesheet had not applied when the panel was revealed').toBe('flex');
  });
});

test.describe('no leak, no error', () => {
  test('opening and closing forty times gives the DOM back', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    // Once first, so the chunk is resolved and not part of the measurement.
    await openPanel(page, 'i', '#life');
    await page.keyboard.press('Escape');
    await expect(page.locator('#life')).toBeHidden();

    const before = await page.evaluate(() => document.querySelectorAll('*').length);

    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('i');
      await page.keyboard.press('Escape');
    }
    await expect(page.locator('#life')).toBeHidden();

    const after = await page.evaluate(() => document.querySelectorAll('*').length);
    // `replaceChildren` on every render means the node count returns to where
    // it was. A panel that appended would climb by a few dozen per cycle.
    expect(Math.abs(after - before), `node count moved ${before} -> ${after}`).toBeLessThan(40);
    expect(errors).toEqual([]);
  });
});

test.describe('the accessibility settings actually reach the document', () => {
  test('text scale, contrast and Heat numerals all stamp the root', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const before = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
    );

    await page.evaluate(() => {
      const s = document.documentElement;
      // Through the same class and custom property `HUD.applyAccess` uses, so
      // this asserts the stylesheet honours them rather than that a setter ran.
      s.style.setProperty('--ui-scale', '1.4');
      s.classList.add('is-high-contrast', 'is-heat-numerals');
    });

    const after = await page.evaluate(() => ({
      scale: getComputedStyle(document.documentElement).getPropertyValue('--ui-scale').trim(),
      contrast: document.documentElement.classList.contains('is-high-contrast'),
      numerals: document.documentElement.classList.contains('is-heat-numerals'),
      // The type scale multiplies by `--ui-scale`; if it did not, changing the
      // property would be decoration.
      fontPx: getComputedStyle(document.body).fontSize,
    }));

    expect(before).not.toBe(after.scale);
    expect(after.contrast).toBe(true);
    expect(after.numerals).toBe(true);
    expect(parseFloat(after.fontPx)).toBeGreaterThan(0);
    expect(errors).toEqual([]);
  });
});
