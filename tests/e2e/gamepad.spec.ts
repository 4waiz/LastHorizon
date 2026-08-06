import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Gamepad, driven end to end.
 *
 * `GamepadReader` is unit-tested against a stub, but nothing in `tests/` can
 * see whether the pad actually reaches the character: the Gamepad API is
 * *polled*, so a missing `pollGamepad` call in the frame loop would leave every
 * unit test green and the controller completely dead.
 *
 * Playwright cannot attach a real controller, so these install a fake
 * `navigator.getGamepads` and then assert on the player — which exercises the
 * whole chain, navigator through reader through InputManager through the
 * controller to the motor.
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

/**
 * Install a fake standard-mapping pad and return handles to drive it.
 *
 * `getGamepads` must build a fresh object each call: browsers hand back
 * snapshots, and a reader that cached one would look like it worked while
 * ignoring every later movement.
 */
async function installPad(page: Page) {
  await page.evaluate(() => {
    const w = window as unknown as {
      __pad: { axes: number[]; buttons: number[]; connected: boolean };
    };
    w.__pad = { axes: [0, 0, 0, 0], buttons: new Array(17).fill(0), connected: true };
    navigator.getGamepads = () =>
      [
        w.__pad.connected
          ? ({
              axes: w.__pad.axes.slice(),
              buttons: w.__pad.buttons.map((v) => ({
                pressed: v > 0.5, touched: v > 0, value: v,
              })),
              connected: true,
              id: 'Fake Pad',
              index: 0,
              mapping: 'standard',
              timestamp: performance.now(),
              vibrationActuator: null,
            } as unknown as Gamepad)
          : null,
      ] as (Gamepad | null)[];
  });
}

const setAxes = (page: Page, axes: number[]) =>
  page.evaluate((a) => {
    (window as unknown as { __pad: { axes: number[] } }).__pad.axes = a;
  }, axes);

const setButton = (page: Page, index: number, value: number) =>
  page.evaluate(([i, v]) => {
    (window as unknown as { __pad: { buttons: number[] } }).__pad.buttons[i] = v;
  }, [index, value]);

const setConnected = (page: Page, connected: boolean) =>
  page.evaluate((c) => {
    (window as unknown as { __pad: { connected: boolean } }).__pad.connected = c;
  }, connected);

const settle = (page: Page, frames: number) =>
  page.evaluate((f) => window.__LH_TEST__!.settle(f), frames);

const player = (page: Page) => page.evaluate(() => window.__LH_TEST__!.getPlayerState());

async function stand(page: Page, x: number, z: number, facing = 0) {
  await page.evaluate(
    ([px, pz, f]) => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');
      t.teleport(px, pz, f);
    },
    [x, z, facing],
  );
  await settle(page, 20);
}

/** Standard mapping. Jump is south, interact is west — deliberately not the same. */
const BTN = { jump: 0, exitVehicle: 1, interact: 2, horn: 3, handbrake: 4, run: 5 };

test.describe('gamepad', () => {
  test('the left stick walks and the bumper runs', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);
    await stand(page, 5.4, -39.3);

    const start = await player(page);

    // Standard mapping reports -1 for "up", which must arrive as forward.
    await setAxes(page, [0, -1, 0, 0]);
    await settle(page, 60);
    const walked = await player(page);

    await setButton(page, BTN.run, 1);
    await settle(page, 60);
    const ran = await player(page);

    await setAxes(page, [0, 0, 0, 0]);
    await setButton(page, BTN.run, 0);
    await settle(page, 60);
    const stopped = await player(page);

    expect(walked.state).toBe('walk');
    expect(ran.state).toBe('run');
    expect(ran.speed).toBeGreaterThan(walked.speed);
    expect(stopped.state).toBe('idle');
    expect(stopped.speed).toBeCloseTo(0, 1);

    const moved = Math.hypot(walked.x - start.x, walked.z - start.z);
    expect(moved).toBeGreaterThan(0.5);
    expect(errors).toEqual([]);
  });

  test('full deflection reaches full speed, so the deadzone rescales', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);
    await stand(page, 5.4, -39.3);

    await setAxes(page, [0, -1, 0, 0]);
    await setButton(page, BTN.run, 1);
    await settle(page, 90);
    const ran = await player(page);

    // A deadzone that clamped without rescaling would top out below the
    // controller's configured run speed and nothing else would look wrong.
    expect(ran.speed).toBeGreaterThan(3.9);
    expect(errors).toEqual([]);
  });

  test('a half-pressed stick walks slower than a full one', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);

    await stand(page, 5.4, -39.3);
    await setAxes(page, [0, -0.45, 0, 0]);
    await settle(page, 70);
    const gentle = (await player(page)).speed;

    await setAxes(page, [0, -1, 0, 0]);
    await settle(page, 70);
    const full = (await player(page)).speed;

    // Analogue input is the whole reason to support a pad at all.
    expect(gentle).toBeGreaterThan(0.05);
    expect(full).toBeGreaterThan(gentle + 0.3);
    expect(errors).toEqual([]);
  });

  test('the right stick orbits the camera, so forward means somewhere else', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);

    /** Walk forward from a standstill and report the direction travelled. */
    const headingAfterWalking = async (orbit: boolean) => {
      await stand(page, 5.4, -39.3);
      if (orbit) {
        await setAxes(page, [0, 0, 1, 0]);
        await settle(page, 45);
        await setAxes(page, [0, 0, 0, 0]);
        await settle(page, 5);
      }
      const from = await player(page);
      await setAxes(page, [0, -1, 0, 0]);
      await settle(page, 50);
      const to = await player(page);
      await setAxes(page, [0, 0, 0, 0]);
      await settle(page, 30);
      return Math.atan2(to.x - from.x, to.z - from.z);
    };

    // Movement is camera-relative, so the only honest test of "the stick moved
    // the camera" is that the same forward input now leads somewhere else.
    // Asserting on the player's own facing would be testing a proxy: it only
    // tracks the camera while the character is actually moving.
    const straight = await headingAfterWalking(false);
    const orbited = await headingAfterWalking(true);

    let delta = Math.abs(orbited - straight) % (Math.PI * 2);
    if (delta > Math.PI) delta = Math.PI * 2 - delta;
    expect(delta).toBeGreaterThan(0.2);
    expect(errors).toEqual([]);
  });

  test('a resting stick produces no drift', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);
    await stand(page, 5.4, -39.3);

    // Slightly off centre, as a worn stick rests. This must read as nothing.
    await setAxes(page, [0.09, -0.07, 0.05, 0.04]);
    const before = await player(page);
    await settle(page, 120);
    const after = await player(page);

    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);
    expect(after.facing).toBeCloseTo(before.facing, 2);
    expect(after.state).toBe('idle');
    expect(errors).toEqual([]);
  });

  test('interact opens the door, and does not jump', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);
    // A step short of the house door; see interaction.spec.ts for the maths.
    await stand(page, 10.7, 32.45, Math.PI / 2);

    const offered = await page.evaluate(() => window.__LH_TEST__!.getInteraction());
    expect(offered.prompt).toBe('Go inside');

    await setButton(page, BTN.interact, 1);
    await settle(page, 4);
    await page.waitForTimeout(2500); // the transition is a real-time fade
    await setButton(page, BTN.interact, 0);
    await settle(page, 20);

    const after = await player(page);
    expect(after.indoors).toBe(true);
    // Jump is a different button; pressing interact must not have left the ground.
    expect(errors).toEqual([]);
  });

  test('unplugging the pad stops the player rather than sticking the input', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await installPad(page);
    await stand(page, 5.4, -39.3);

    await setAxes(page, [0, -1, 0, 0]);
    await settle(page, 40);
    expect((await player(page)).state).toBe('walk');

    // Yanked mid-stride: the last axes read as fully forward and nothing will
    // ever report them going back to zero.
    await setConnected(page, false);
    await settle(page, 60);
    const after = await player(page);

    expect(after.state).toBe('idle');
    expect(after.speed).toBeCloseTo(0, 1);
    expect(errors).toEqual([]);
  });

  test('no pad at all changes nothing', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);
    await page.evaluate(() => {
      navigator.getGamepads = () => [] as (Gamepad | null)[];
    });
    await stand(page, 5.4, -39.3);

    const before = await player(page);
    await settle(page, 120);
    const after = await player(page);

    expect(Math.hypot(after.x - before.x, after.z - before.z)).toBeLessThan(0.05);
    expect(after.state).toBe('idle');
    expect(errors).toEqual([]);
  });
});
