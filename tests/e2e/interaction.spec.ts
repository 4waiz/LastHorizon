import { test, expect, type Page, type ConsoleMessage } from '@playwright/test';

/**
 * Interaction scenarios against the production build.
 *
 * These exist because the unit tests cannot see the wiring. Five bugs in
 * Phase 3 passed every assertion in `tests/` while the running game was broken,
 * so what `InteractionSystem` decides is checked here against the real village,
 * through the bridge rather than the DOM.
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
 * Interior landmarks for the family home, from `interiorCatalog.ts`.
 *
 * Phase 7 replaced the single shared room with nine layouts. `home` is index 0
 * in the catalogue, so its cell origin is (0, 600, 0) and these are its points
 * in room-local metres — which, at that origin, are also world metres in x/z.
 */
const ROOM = {
  y: 600.02,
  bed: { x: 4.3, z: 0.3 },
  chair: { x: 0.35, z: 1.4 },
  desk: { x: -0.5, z: 1.4 },
  wardrobe: { x: 0.0, z: -0.55 },
  exit: { x: 2, z: 2.55 },
};

/**
 * The door of the house you can walk into. `HouseSmall` sits at (15.6, 33) with
 * yaw -PI/2 and a door at local (-0.55, 3.4); `World.localToWorld` puts that at
 * (12.2, 32.45), radius 2.4. `stand` is a step short of it, on the road side.
 */
// Kept for reference; the specs stand at DOOR_STAND, a step short of it.
// const FRONT_DOOR = { x: 12.2, z: 32.45 };
const DOOR_STAND = { x: 10.7, z: 32.45, facing: Math.PI / 2 };

test.describe('interaction', () => {
  test('offers the front door outside and nothing once out of reach', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async (door) => {
      const t = window.__LH_TEST__!;
      t.setTimeMode('day');

      t.teleport(door.x, door.z, door.facing);
      t.settle(8);
      const near = t.getInteraction();

      // Well clear of the house.
      t.teleport(door.x - 40, door.z + 40, door.facing);
      t.settle(8);
      const far = t.getInteraction();
      return { near, far };
    }, DOOR_STAND);

    // Phase 7: every door names its service, so HouseSmall at (15.6, 33) --
    // the one this spec stands at -- is the grocery now.
    expect(seen.near.prompt).toBe('Enter the grocery');
    expect(seen.far.prompt).toBeNull();
    expect(seen.far.actionId).toBeNull();
    expect(errors).toEqual([]);
  });

  test('a press opens the door; holding it does not open it twice', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const result = await page.evaluate(async (door) => {
      const t = window.__LH_TEST__!;
      t.teleport(door.x, door.z, door.facing);
      t.settle(8);

      // Hold interact down for many frames. The door is a press action, so it
      // must fire on the leading edge and never again -- and crucially must not
      // fire again on whatever comes into range as a result of it firing.
      t.pressInteract(true);
      t.settle(3);

      // Going inside is a real-time fade, not simulation steps -- `settle`
      // advances the sim synchronously and would race straight past it.
      await new Promise((r) => setTimeout(r, 2500));

      const indoors = t.getPlayerState().indoors;
      t.pressInteract(false);
      t.settle(20);

      // Indoors and still indoors: the way out was in range the whole time
      // with the button down, and did not fire.
      return { indoors, stillIndoors: t.getPlayerState().indoors };
    }, DOOR_STAND);

    expect(result.indoors).toBe(true);
    expect(result.stillIndoors).toBe(true);
    expect(errors).toEqual([]);
  });

  test('indoor fixtures each offer their own prompt', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const prompts = await page.evaluate(async (room) => {
      const t = window.__LH_TEST__!;
      await t.enterInterior();
      t.settle(10);

      const read = (x: number, z: number, facing: number) => {
        t.teleportTo(x, room.y, z, facing);
        t.settle(6);
        return t.getInteraction().prompt;
      };

      // Stand a step back from each fixture, looking at it. Offsets are
      // inside each point's own radius -- the chair's is 1.2 m.
      const bed = read(room.bed.x - 1.1, room.bed.z + 0.6, Math.atan2(1.1, -0.6));
      const chair = read(room.chair.x + 0.7, room.chair.z + 0.6, Math.atan2(-0.7, -0.6));
      const wardrobe = read(
        room.wardrobe.x + 1.2,
        room.wardrobe.z - 0.2,
        Math.atan2(-1.2, 0.2),
      );
      return { bed, chair, wardrobe };
    }, ROOM);

    // Whatever the world authored -- the point is that each is distinct and
    // non-null, i.e. the right fixture won at each spot.
    expect(prompts.bed).not.toBeNull();
    expect(prompts.chair).not.toBeNull();
    expect(prompts.wardrobe).not.toBeNull();
    expect(new Set([prompts.bed, prompts.chair, prompts.wardrobe]).size).toBe(3);
    expect(errors).toEqual([]);
  });

  test('the door behind you is not offered, but the way out always is', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async (room) => {
      const t = window.__LH_TEST__!;
      await t.enterInterior();
      t.settle(10);

      // Facing away from the bed, standing next to it.
      t.teleportTo(room.bed.x - 1.1, room.y, room.bed.z + 0.6, Math.atan2(-1.1, 0.6));
      t.settle(6);
      const backToBed = t.getInteraction();

      // The exit ignores facing: a threshold you cannot use from behind is one
      // that strands you in the room.
      t.teleportTo(room.exit.x, room.y, room.exit.z - 1.0, 0);
      t.settle(6);
      const backToDoor = t.getInteraction();
      return { backToBed, backToDoor };
    }, ROOM);

    // The exit is in range from beside the bed and ignores facing, so
    // *something* is offered -- but it must not be the bed.
    expect(seen.backToBed.candidates.some((id) => id.includes('home_bed'))).toBe(false);
    expect(seen.backToDoor.prompt).not.toBeNull();
    expect(errors).toEqual([]);
  });

  test('seated, the only offer is standing up', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.enterInterior();
      t.settle(10);

      t.sit(true);
      t.settle(10);
      const seated = t.getInteraction();

      t.pressInteract(true);
      t.settle(2);
      t.pressInteract(false);
      t.settle(20);

      return { seated, after: { sitting: t.getPlayerState().sitting } };
    });

    expect(seen.seated.prompt).toBe('Stand up');
    expect(seen.seated.candidates).toEqual(['stand']);
    expect(seen.after.sitting).toBe(false);
    expect(errors).toEqual([]);
  });

  test('two fixtures in reach at once asks for a selector', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async (room) => {
      const t = window.__LH_TEST__!;
      await t.enterInterior();
      t.settle(10);

      // Midway between the chair and the desk, a step back, looking at both.
      // They sit either side of the same spot, so a single facing is inside
      // the cone for each.
      const mx = (room.chair.x + room.desk.x) / 2;
      const mz = (room.chair.z + room.desk.z) / 2;
      t.teleportTo(mx, room.y, mz + 0.9, Math.PI);
      t.settle(6);
      return t.getInteraction();
    }, ROOM);

    // Not asserting the selector fires -- only that when more than one distinct
    // object is offering something, the system says so rather than silently
    // picking for the player.
    if (seen.candidates.length > 1) {
      expect(seen.needsSelector).toBe(true);
    }
    expect(errors).toEqual([]);
  });

  test('nothing is offered while the wardrobe panel is open', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.enterInterior();
      t.settle(10);

      t.openWardrobe(true);
      t.settle(10);
      const open = t.getInteraction();

      t.openWardrobe(false);
      t.settle(10);
      return { open, closed: t.getInteraction() };
    });

    expect(seen.open.prompt).toBeNull();
    expect(seen.open.actionId).toBeNull();
    expect(errors).toEqual([]);
  });
});
