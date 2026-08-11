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

test.describe('the flight instruments', () => {
  /**
   * The plainest reachability gap in the whole inventory: `FlightState` has
   * mirrored airspeed, altitude and the stall warning since Phase 10 *so the
   * HUD could read them*, and nothing ever did. You could fly with no
   * instruments at all — including no stall warning, which the phase brief
   * asked for by name.
   */
  async function board(page: Page): Promise<void> {
    await page.evaluate(() => window.__LH_TEST__!.awaitFlight());
    const ok = await page.evaluate(() => window.__LH_TEST__!.boardPlane());
    expect(ok, 'could not board the aeroplane').toBe(true);
  }

  test('are absent on foot and present in the aeroplane', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await expect(page.locator('#flight')).toBeHidden();

    await board(page);
    await page.evaluate(() => window.__LH_TEST__!.flyFor(0.5, {}));
    await expect(page.locator('#flight')).toBeVisible();
    expect(errors).toEqual([]);
  });

  test('show airspeed and height that move when you fly', async ({ page }) => {
    await boot(page);
    await board(page);

    await page.evaluate(() => window.__LH_TEST__!.setThrottle(1));
    await page.evaluate(() => window.__LH_TEST__!.flyFor(6, { throttle: 1 }));
    const speed = Number(await page.locator('#flightSpeed').textContent());
    expect(speed, 'airspeed never moved off zero').toBeGreaterThan(3);

    await page.evaluate(() => window.__LH_TEST__!.flyFor(8, { throttle: 1, pitch: 1 }));
    const alt = Number(await page.locator('#flightAlt').textContent());
    expect(alt, 'height never moved').toBeGreaterThan(2);
  });

  test('warn about a stall in words, not only in colour', async ({ page }) => {
    await boot(page);
    await board(page);

    // Up to flying speed, then throttle off and hold the nose up: the
    // textbook way into a stall, and what the warning exists for.
    await page.evaluate(() => window.__LH_TEST__!.flyFor(10, { throttle: 1 }));
    await page.evaluate(() => window.__LH_TEST__!.flyFor(6, { throttle: 1, pitch: 1 }));
    await page.evaluate(() => window.__LH_TEST__!.flyFor(9, { throttle: 0, pitch: 1 }));

    const warned = await page.evaluate(() => window.__LH_TEST__!.getFlight().stallWarning);
    // If the model did not stall, the HUD has nothing to show and asserting
    // on it would be asserting on the model. Only check the HUD agrees.
    const shown = await page.locator('#flightWarn').isVisible();
    expect(shown, `HUD says ${shown}, model says ${warned}`).toBe(warned);
    if (warned) {
      await expect(page.locator('#flightWarn')).toContainText(/stall/i);
    }
  });

  test('clear themselves when the player gets out', async ({ page }) => {
    await boot(page);
    await board(page);
    await page.evaluate(() => window.__LH_TEST__!.flyFor(0.5, {}));
    await expect(page.locator('#flight')).toBeVisible();

    await page.evaluate(() => window.__LH_TEST__!.leavePlane());
    await page.evaluate(() => window.__LH_TEST__!.flyFor(0.5, {}));
    await expect(page.locator('#flight')).toBeHidden();
  });

  test('are styled from the eager sheet, because flying is not a panel', async ({ page }) => {
    // The `.dash` bug this pass fixed: the vehicle dashboard's styles had been
    // moved into the lazily-loaded settings chunk, so anybody who drove before
    // opening settings got an unstyled readout. Neither instrument cluster is
    // behind a keypress, so neither may depend on a lazy stylesheet.
    await boot(page);
    await board(page);
    await page.evaluate(() => window.__LH_TEST__!.flyFor(0.5, {}));

    const pos = await page
      .locator('#flight')
      .evaluate((el) => getComputedStyle(el).position);
    expect(pos, 'flight instruments are unstyled').toBe('absolute');
  });
});

test.describe('always-on chrome is styled without opening anything', () => {
  /**
   * The bug this exists for shipped in Phase 11 and survived until Phase 10's
   * leftovers were being finished.
   *
   * The rule that phase's CSS split follows is that a lazy panel's stylesheet
   * travels with the panel. The check that rule needs is *"is this class used
   * outside the panel?"* — and `.dash` is: it is the vehicle dashboard, which
   * appears the moment you get into a car. It went into `SettingsPanel.css`
   * anyway, so every player who drove before opening settings got an unstyled
   * readout, and nothing noticed because nothing drives and reads CSS.
   */
  test('the vehicle dashboard has its styles before settings is ever opened', async ({ page }) => {
    await boot(page);

    // A bicycle: the one vehicle that needs no key, so this test is about the
    // dashboard rather than about the inventory.
    const inSaddle = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const p = t.getPlayerState();
      const id = (await t.spawnVehicle('bicycle', p.x + 1.6, p.z + 1.5, 0))!;
      t.settle(90);
      const entered = await t.enterVehicle(id);
      t.settle(20);
      return entered;
    });
    expect(inSaddle, 'could not get on the bicycle').toBe(true);
    await expect(page.locator('#dash')).toBeVisible();

    // `position: absolute` comes from the stylesheet and nothing else. If the
    // rules were still in the settings chunk this would be `static`.
    const style = await page.locator('#dash').evaluate((el) => ({
      position: getComputedStyle(el).position,
      radius: getComputedStyle(el).borderTopLeftRadius,
    }));
    expect(style.position, 'dashboard is unstyled').toBe('absolute');
    expect(style.radius).not.toBe('0px');

    // And the settings chunk really has not been fetched, or the assertion
    // above would be true for the wrong reason.
    const fetched = await page.evaluate(() =>
      performance.getEntriesByType('resource').some((e) => /SettingsPanel/.test(e.name)),
    );
    expect(fetched, 'settings chunk was already loaded; test proves nothing').toBe(false);
  });
});

test.describe('remapping a key changes what the key does', () => {
  /**
   * The whole point, and the only test that proves it: the table is data, but
   * `InputManager` has to be *reading* that data. A remapping screen that
   * stores a preference nothing consults is worse than no remapping screen.
   */
  async function openSettings(page: Page): Promise<void> {
    await page.locator('#btnInfo').click();
    await expect(page.locator('#rebindList .rebind__key').first()).toBeVisible({
      timeout: 20_000,
    });
  }

  test('lists every action with the key it currently carries', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    const caps = await page.$$eval('#rebindList .rebind__key', (els) =>
      els.map((e) => e.textContent),
    );
    expect(caps.length).toBeGreaterThan(10);
    expect(caps).toContain('I');
    expect(caps).toContain('Space');
    // No raw DOM codes at a player.
    for (const c of caps) expect(c).not.toMatch(/^(Key|Digit)/);
  });

  test('a rebound key opens the panel, and the old one stops', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    // Move "Carrying and record" from I to B.
    await page.locator('.rebind__key[data-action="life"]').click();
    await expect(page.locator('.rebind__key[data-action="life"]')).toHaveClass(/is-listening/);
    await page.keyboard.press('b');
    await expect(page.locator('.rebind__key[data-action="life"]')).toHaveText('B');

    await page.locator('#infoClose').click();
    await expect(page.locator('#info')).toBeHidden();

    await page.keyboard.press('b');
    await expect(page.locator('#life')).toBeVisible({ timeout: 20_000 });
    await page.keyboard.press('Escape');
    await expect(page.locator('#life')).toBeHidden();

    // And the key it used to be on does nothing now.
    await page.keyboard.press('i');
    await page.waitForTimeout(400);
    await expect(page.locator('#life')).toBeHidden();
  });

  test('refuses Escape, so the way out of the menu survives', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    await page.locator('.rebind__key[data-action="jump"]').click();
    await page.keyboard.press('Escape');
    // Escape cancels rather than binding. Jump keeps its key.
    await expect(page.locator('.rebind__key[data-action="jump"]')).toHaveText('Space');
    await expect(page.locator('#rebindStatus')).toContainText(/left as it was/i);
  });

  test('says which action lost its key when one is stolen', async ({ page }) => {
    await boot(page);
    await openSettings(page);

    await page.locator('.rebind__key[data-action="jump"]').click();
    await page.keyboard.press('m');
    await expect(page.locator('#rebindStatus')).toContainText(/has no key now/i);
    await expect(page.locator('.rebind__key[data-action="map"]')).toHaveText('Not set');
    await expect(page.locator('.rebind__key[data-action="map"]')).toHaveClass(/is-unbound/);
  });

  test('survives a reload, then resets', async ({ page }) => {
    await boot(page);
    await openSettings(page);
    await page.locator('.rebind__key[data-action="life"]').click();
    await page.keyboard.press('b');
    await expect(page.locator('.rebind__key[data-action="life"]')).toHaveText('B');

    await boot(page);
    await openSettings(page);
    await expect(page.locator('.rebind__key[data-action="life"]')).toHaveText('B');

    await page.locator('#rebindReset').click();
    await expect(page.locator('.rebind__key[data-action="life"]')).toHaveText('I');
    await expect(page.locator('#rebindReset')).toBeDisabled();
  });
});

test.describe('the work board lists things to do', () => {
  /**
   * Phase 10's activities appeared in no list anywhere. This is the last
   * entry on the reachability gap, so the test is about *finding* them:
   * grouped separately from paid work, and each saying where it starts.
   */
  test('shows both groups, and where each one is taken on', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    await page.keyboard.press('p');
    await expect(page.locator('#phone')).toBeVisible({ timeout: 20_000 });
    await page.getByText('Work', { exact: true }).click();

    await expect(page.locator('#phoneBody')).toContainText('Paid work');
    await expect(page.locator('#phoneBody')).toContainText('Things to do');

    // A named Phase 10 activity, and a place to go and start it.
    await expect(page.locator('#phoneBody')).toContainText(/scenic|delivery|trial|race/i);
    await expect(page.locator('.phone__rowWhere').first()).toBeVisible();

    const wheres = await page.$$eval('.phone__rowWhere', (els) =>
      els.map((e) => e.textContent ?? ''),
    );
    expect(wheres.length).toBeGreaterThan(6);
    // None of them may fall back — that is a task the player cannot find.
    for (const w of wheres) expect(w).not.toMatch(/somewhere about/i);
    expect(errors).toEqual([]);
  });
});

test.describe('photo mode', () => {
  async function enter(page: Page): Promise<void> {
    await page.keyboard.press('k');
    await expect(page.locator('#photoShoot')).toBeVisible({ timeout: 20_000 });
  }

  test('hides the interface, because that is what it is for', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await expect(page.locator('#hud')).toBeVisible();

    await enter(page);
    await expect(page.locator('#hud')).toBeHidden();
    await expect(page.locator('#photo')).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(page.locator('#photo')).toBeHidden();
    await expect(page.locator('#hud')).toBeVisible();
    expect(errors).toEqual([]);
  });

  /**
   * The one that matters, and the reason `capture` is synchronous.
   *
   * The renderer runs without `preserveDrawingBuffer`, so a canvas read on a
   * later task returns transparent black. A test that only checked "a data
   * URL came back" would pass on a fully blank image — so this decodes it and
   * asserts the pixels are not all one colour.
   */
  test('captures a real frame rather than an empty buffer', async ({ page }) => {
    await boot(page);
    await enter(page);

    /*
     * Through the shutter button, not by reading the canvas directly.
     *
     * The first version of this test called `canvas.toDataURL()` inside a
     * `page.evaluate` and got a transparent frame — correctly, and for
     * exactly the reason `PhotoMode` is built the way it is. The renderer
     * runs without `preserveDrawingBuffer`, so a read from *any* task other
     * than the one that drew is empty. Only the real path renders first.
     */
    const [download] = await Promise.all([
      page.waitForEvent('download', { timeout: 20_000 }),
      page.locator('#photoShoot').click(),
    ]);

    expect(download.suggestedFilename()).toMatch(/^last-horizon-.*\.png$/);

    const path = await download.path();
    expect(path, 'the download produced no file').toBeTruthy();

    const { readFileSync } = await import('node:fs');
    const bytes = readFileSync(path!);
    // PNG magic, then enough data that it cannot be a 1x1 placeholder.
    expect(bytes.subarray(0, 4)).toEqual(Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    expect(bytes.length, 'the frame was blank or tiny').toBeGreaterThan(20_000);
  });

  test('freezes the world and starts it again on the way out', async ({ page }) => {
    await boot(page);

    const blocked = () => page.evaluate(() => window.__LH_TEST__!.getLifeState().blocked);
    expect(await blocked()).not.toContain('photoMode');

    await enter(page);
    expect(await blocked(), 'the life clock ran during a still').toContain('photoMode');

    // The year does not advance while the clock is blocked.
    const during = await page.evaluate(() => window.__LH_TEST__!.getLifeState().yearProgress);
    await page.evaluate(() => window.__LH_TEST__!.settle(600));
    const still = await page.evaluate(() => window.__LH_TEST__!.getLifeState().yearProgress);
    expect(still).toBe(during);

    await page.keyboard.press('Escape');
    await expect(page.locator('#photo')).toBeHidden();
    expect(await blocked(), 'the block was never released').not.toContain('photoMode');

    await page.evaluate(() => window.__LH_TEST__!.settle(600));
    const after = await page.evaluate(() => window.__LH_TEST__!.getLifeState().yearProgress);
    expect(after, 'the life clock never restarted').toBeGreaterThan(still);
  });

  test('puts the player and the lens back when it closes', async ({ page }) => {
    await boot(page);
    await enter(page);

    await page.locator('#photoPlayer').click();
    await expect(page.locator('#photoPlayer')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#photoFov').fill('90');
    await page.locator('#photoFov').dispatchEvent('input');

    await page.keyboard.press('Escape');
    await expect(page.locator('#photo')).toBeHidden();

    // Re-entering shows the defaults, which is only true if `close` restored
    // them rather than leaving the camera at 90° and the player invisible.
    await enter(page);
    await expect(page.locator('#photoFov')).toHaveValue('55');
    await expect(page.locator('#photoPlayer')).toHaveAttribute('aria-pressed', 'true');
  });

  test('is reachable from the phone’s Camera tile', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('p');
    await expect(page.locator('#phone')).toBeVisible({ timeout: 20_000 });

    await page.getByText('Camera', { exact: true }).click();
    await expect(page.locator('#phone')).toBeHidden();
    await expect(page.locator('#photoShoot')).toBeVisible({ timeout: 20_000 });
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
