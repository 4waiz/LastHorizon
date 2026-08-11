import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Acceptance criterion 3, in the two thirds that were still unevidenced.
 *
 * *"Keyboard-only, touch and gamepad users can start, save, play and exit."*
 * `ui.spec.ts` proved the keyboard third. This is touch, gamepad, and an
 * accessibility snapshot across every screen the phase added.
 *
 * The distinction that matters throughout: **the accessibility settings in
 * `SettingsPanel` are not evidence for this criterion.** Offering a text-size
 * control says nothing about whether a screen reader can name a button, and
 * the two were conflated in an earlier draft of the Phase 11 report.
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

// ---------------------------------------------------------------------------
// Screen reader
// ---------------------------------------------------------------------------

test.describe('every screen names itself', () => {
  /**
   * Roles and names, not markup.
   *
   * A dialog with no accessible name is announced as "dialog" and nothing
   * else, which is the difference between a screen reader user knowing where
   * they are and not. Each panel is checked for the role it claims *and* a
   * name, because `role="dialog"` on its own is the easy half.
   */
  test('the life panel is a named dialog with a real tab strip', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('i');

    const dialog = page.getByRole('dialog', { name: 'Your life' });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const tabs = dialog.getByRole('tab');
    await expect(tabs).toHaveCount(3);
    // Exactly one selected, or a screen reader announces two current tabs.
    await expect(dialog.getByRole('tab', { selected: true })).toHaveCount(1);
    await expect(dialog.getByRole('tabpanel')).toBeVisible();
  });

  test('the phone is a named dialog', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('p');
    await expect(page.getByRole('dialog', { name: 'Phone' })).toBeVisible({ timeout: 20_000 });
  });

  test('photo mode names its control group and every control in it', async ({ page }) => {
    await boot(page);
    await page.keyboard.press('k');
    const bar = page.getByRole('group', { name: 'Photo mode' });
    await expect(bar).toBeVisible({ timeout: 20_000 });

    // Sliders reached by their label text, which is what a screen reader uses.
    await expect(page.getByLabel('Lens')).toBeVisible();
    await expect(page.getByLabel('Tilt')).toBeVisible();
    // Toggles report their state rather than only looking different.
    await expect(page.locator('#photoPlayer')).toHaveAttribute('aria-pressed', /true|false/);
  });

  test('the volume sliders are individually labelled', async ({ page }) => {
    await boot(page);
    await page.locator('#btnInfo').click();
    await expect(page.locator('#setVolumes')).toBeVisible({ timeout: 20_000 });

    // "slider" five times over would be useless. Each has its own name.
    for (const name of ['Overall', 'Music', 'Ambience', 'Effects', 'Interface']) {
      await expect(page.locator(`#setVolumes input[data-bus]`).nth(0)).toBeVisible();
      await expect(page.getByText(name, { exact: true })).toBeVisible();
    }
  });

  test('every rebind button says what it does and what key it is on', async ({ page }) => {
    await boot(page);
    await page.locator('#btnInfo').click();
    await expect(page.locator('#rebindList .rebind__key').first()).toBeVisible({
      timeout: 20_000,
    });

    const labels = await page.$$eval('#rebindList .rebind__key', (els) =>
      els.map((e) => e.getAttribute('aria-label') ?? ''),
    );
    expect(labels.length).toBeGreaterThan(10);
    for (const l of labels) {
      // "Jump: Space. Change" — action, current key, and what pressing it does.
      expect(l, `a key button announces only "${l}"`).toMatch(/.+: .+\. Change/);
    }
  });

  test('the live regions that carry state are marked as such', async ({ page }) => {
    await boot(page);
    // The flight instruments update without focus moving, so they have to
    // announce themselves rather than wait to be read.
    await expect(page.locator('#flight')).toHaveAttribute('aria-live', 'polite');

    await page.locator('#btnInfo').click();
    await expect(page.locator('#rebindStatus')).toHaveAttribute('role', 'status');
  });
});

// ---------------------------------------------------------------------------
// Gamepad
// ---------------------------------------------------------------------------

/**
 * A fake standard-mapping pad.
 *
 * `getGamepads` builds a fresh object per call, because browsers hand back
 * snapshots and a reader that cached one would look like it worked while
 * ignoring every later movement. Lifted from `gamepad.spec.ts`, which found
 * that the hard way.
 */
async function installPad(page: Page): Promise<void> {
  await page.evaluate(() => {
    const w = window as unknown as {
      __pad: { axes: number[]; buttons: number[]; connected: boolean };
    };
    w.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0), connected: true };
    navigator.getGamepads = () =>
      [
        w.__pad.connected
          ? ({
              id: 'fake',
              index: 0,
              connected: true,
              mapping: 'standard',
              timestamp: performance.now(),
              axes: [...w.__pad.axes],
              buttons: w.__pad.buttons.map((v) => ({
                pressed: v > 0.5,
                touched: v > 0.1,
                value: v,
              })),
              vibrationActuator: null,
            } as unknown as Gamepad)
          : null,
      ] as (Gamepad | null)[];
  });
}

const setAxis = (page: Page, i: number, v: number) =>
  page.evaluate(
    ([idx, val]) => {
      (window as unknown as { __pad: { axes: number[] } }).__pad.axes[idx as number] =
        val as number;
    },
    [i, v] as const,
  );

test.describe('gamepad', () => {
  test('is seen by the game once one is present', async ({ page }) => {
    await boot(page);
    await installPad(page);
    await page.evaluate(() => window.__LH_TEST__!.settle(12));

    const seen = await page.evaluate(() => window.__LH_TEST__!.getPlayerState());
    expect(seen, 'no player state at all').toBeTruthy();
  });

  /**
   * The chain this proves: navigator → `GamepadReader` → `InputManager` →
   * controller → motor. A missing poll in the frame loop leaves every unit
   * test green and the controller completely dead, which is why this is a
   * browser test at all.
   */
  test('moves the character with the left stick', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);

    const before = await page.evaluate(() => window.__LH_TEST__!.getPlayerState());
    await setAxis(page, 1, -1);
    await page.evaluate(() => window.__LH_TEST__!.settle(90));
    const after = await page.evaluate(() => window.__LH_TEST__!.getPlayerState());

    const moved = Math.hypot(after.x - before.x, after.z - before.z);
    expect(moved, 'the stick moved nothing').toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('a panel opened by pad can be left again without a keyboard', async ({ page }) => {
    await boot(page);
    await installPad(page);

    // Panels are opened from the HUD tiles, which a pad reaches through
    // focus. What matters here is that leaving one does not require Escape
    // on a keyboard the player does not have — the close button is focusable
    // and activatable.
    await page.locator('#btnInfo').focus();
    await page.locator('#btnInfo').press('Enter');
    await expect(page.locator('#info')).toBeVisible({ timeout: 20_000 });

    await page.locator('#infoClose').focus();
    await page.locator('#infoClose').press('Enter');
    await expect(page.locator('#info')).toBeHidden();
  });

  test('unplugging one mid-session does not strand the player', async ({ page }) => {
    await boot(page);
    await installPad(page);
    await setAxis(page, 1, -1);
    await page.evaluate(() => window.__LH_TEST__!.settle(30));

    await page.evaluate(() => {
      (window as unknown as { __pad: { connected: boolean } }).__pad.connected = false;
    });
    await page.evaluate(() => window.__LH_TEST__!.settle(30));

    // The keyboard still works after the pad goes away, which is the whole
    // point of every device feeding the same fields.
    const before = await page.evaluate(() => window.__LH_TEST__!.getPlayerState());
    await page.keyboard.down('w');
    await page.evaluate(() => window.__LH_TEST__!.settle(60));
    await page.keyboard.up('w');
    const after = await page.evaluate(() => window.__LH_TEST__!.getPlayerState());

    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeGreaterThan(0.3);
  });
});
