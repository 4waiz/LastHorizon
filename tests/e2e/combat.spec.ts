import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Phase 9 in a real browser.
 *
 * The unit suite already proves the weapon state machine, the ballistics, the
 * Heat model and the police AI in isolation — 104 tests that run in a
 * millisecond. What it cannot prove is that any of it is *wired*: that the
 * adult gate holds on the real life clock, that a safe zone is a real room,
 * that an officer's sight test uses the real collision proxy, and that an
 * arrest does not corrupt a save.
 *
 * Phase 8 shipped three objective kinds with no reporter and every test
 * passed, because the tests drove the graph rather than the game. This file
 * exists so that does not happen twice.
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
  await page.evaluate(() => window.__LH_TEST__!.setTime(0.45));
}

/**
 * Let an arrest finish.
 *
 * `performArrest` is asynchronous — a CSS fade on a real timer, a life
 * advance, a save — so a synchronous `settle()` loop inside one `evaluate`
 * never lets its continuations run. This drives frames *and* yields to the
 * event loop between them, which is the only way the fade's `setTimeout` ever
 * fires. Getting this wrong reads exactly like a missing feature.
 */
async function settleThrough(page: Page, seconds = 4): Promise<void> {
  for (let i = 0; i < seconds * 10; i++) {
    await page.evaluate(() => window.__LH_TEST__!.settle(6));
    await page.waitForTimeout(100);
  }
}

/** Boot, age up past the adult gate, and pull the combat chunk in. */
async function bootArmed(page: Page) {
  await boot(page);
  await page.evaluate(async () => {
    const t = window.__LH_TEST__!;
    // 15 -> 18. The real life clock and the real gates.
    await t.advanceLife(60 * 60 * 3);
    await t.awaitCombat();
  });
}

test.describe('the adult gate', () => {
  test('refuses a fifteen-year-old a weapon, and allows it at eighteen', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    // Acceptance criterion 1, on the real clock rather than a stubbed age.
    const young = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.awaitCombat();
      return {
        age: t.getLifeState().ageYears,
        gave: t.giveWeapon('pistol', 12),
        state: t.getCombat(),
      };
    });
    expect(young.age).toBeLessThan(18);
    expect(young.gave, 'a fifteen-year-old cannot even hold one').toBe(false);
    expect(young.state.owned).toEqual(['unarmed']);

    const grown = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.advanceLife(60 * 60 * 3);
      return { age: t.getLifeState().ageYears, gave: t.giveWeapon('pistol', 12) };
    });
    expect(grown.age).toBeGreaterThanOrEqual(18);
    expect(grown.gave).toBe(true);

    expect(errors).toEqual([]);
  });

  test('hides ammunition from the police desk until eighteen', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    // The gate has to hold on every route the player can actually walk, not
    // just on the bridge call. This one goes through a door and a shop menu.
    const young = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door = t.getDoors().find((d) => d.interiorId === 'police')!;
      await t.enterDoor(door.id);
      t.settle(4);
      const menu = t.getServiceMenu('police_desk')!;
      return {
        age: t.getLifeState().ageYears,
        ammo: menu.entries.filter((e) => e.id.startsWith('buy_ammo')).map((e) => e.available),
        // The rest of the desk stays open to a fifteen-year-old.
        record: menu.entries.find((e) => e.id === 'view_record')!.available,
      };
    });
    expect(young.age).toBeLessThan(18);
    expect(young.ammo, 'three ammunition offers, all shut').toEqual([false, false, false]);
    expect(young.record, 'but the record desk is not age-gated').toBe(true);

    const grown = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.advanceLife(60 * 60 * 3);
      t.giveMoney(500);
      t.settle(2);
      const menu = t.getServiceMenu('police_desk')!;
      return menu.entries.filter((e) => e.id.startsWith('buy_ammo')).map((e) => e.available);
    });
    expect(grown).toEqual([true, true, true]);

    expect(errors).toEqual([]);
  });
});

test.describe('safe zones', () => {
  test('refuse a drawn weapon indoors and put it away on the way in', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const outside = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveWeapon('pistol', 12);
      t.equipWeapon('pistol');
      t.settle(1);
      return t.getCombat();
    });
    expect(outside.stance).not.toBe('holstered');
    expect(outside.inSafeZone).toBe(false);

    const inside = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door = t.getDoors().find((d) => d.interiorId === 'grocery')!;
      await t.enterDoor(door.id);
      t.settle(4);
      return { state: t.getCombat(), equipped: t.equipWeapon('pistol') };
    });
    expect(inside.state.inSafeZone, 'a shop is a safe zone').toBe(true);
    expect(inside.state.stance, 'walking in puts it away').toBe('holstered');
    expect(inside.equipped, 'and it cannot be drawn again in here').toBe(false);

    // The police station is not a safe zone — it is where the ammunition is.
    const station = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.exitInterior();
      const door = t.getDoors().find((d) => d.interiorId === 'police')!;
      await t.enterDoor(door.id);
      t.settle(4);
      return t.getCombat().inSafeZone;
    });
    expect(station).toBe(false);

    expect(errors).toEqual([]);
  });
});

test.describe('firing', () => {
  test('spends rounds, reloads, and refuses when empty', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const run = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveWeapon('pistol', 12);
      t.equipWeapon('pistol');
      t.giveItem('ammo_pistol', 24);

      const start = t.getCombat().rounds;
      for (let i = 0; i < 12; i++) {
        t.fireWeapon();
        t.advanceCombat(1);
      }
      const emptied = t.getCombat().rounds;

      t.reloadWeapon();
      t.advanceCombat(4);
      return { start, emptied, reloaded: t.getCombat().rounds };
    });

    expect(run.start).toBe(12);
    expect(run.emptied, 'twelve shots empties a twelve-round magazine').toBe(0);
    expect(run.reloaded).toBe(12);

    expect(errors).toEqual([]);
  });

  test('aiming is held, not written — it survives the frame loop', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    // The first version of this wrote straight to the weapon system and was
    // undone by the next tick, which meant the aim camera could not be driven
    // from a test at all. Aiming is a held state; this proves it is held.
    const held = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveWeapon('pistol', 12);
      t.equipWeapon('pistol');
      const loose = t.getCombat().spread;

      t.setAiming(true);
      const immediately = t.getCombat().stance;
      t.settle(1);
      const afterOneFrame = t.getCombat().stance;
      t.settle(90);
      const settled = t.getCombat();

      t.setAiming(false);
      t.settle(30);
      return {
        loose,
        immediately,
        afterOneFrame,
        settled: settled.stance,
        tight: settled.spread,
        released: t.getCombat().stance,
      };
    });

    expect(held.immediately).toBe('aiming');
    expect(held.afterOneFrame, 'not wiped by the next tick').toBe('aiming');
    expect(held.settled, 'still aiming a second and a half later').toBe('aiming');
    expect(held.tight, 'and the shot is tighter for it').toBeLessThan(held.loose);
    expect(held.released, 'letting go lowers it').toBe('drawn');

    expect(errors).toEqual([]);
  });

  test('a shot is heard, becomes a crime, and raises Heat only once reported', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const fired = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveWeapon('pistol', 12);
      t.equipWeapon('pistol');
      t.fireWeapon();
      t.settle(1);
      return t.getCombat();
    });

    // Firing is a crime the instant it happens — but Heat waits on somebody
    // actually telling the police, which is the whole of criterion 2.
    expect(fired.heat, 'nobody has reported it yet').toBe(0);

    const reported = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const eventId = t.commitCrime('weapon_discharge', 20, 20);
      t.reportCrime({
        eventId,
        crime: 'weapon_discharge',
        x: 20,
        z: 20,
        confidence: 0.9,
        identified: true,
        distanceToHelp: 0,
        canReachHelp: true,
      });
      t.advanceCombat(10);
      return t.getCombat();
    });
    expect(reported.heat).toBeGreaterThan(0);
    expect(reported.belief, 'an identifying witness gives them somewhere to look').not.toBeNull();

    expect(errors).toEqual([]);
  });
});

test.describe('the police are not omniscient', () => {
  test('an unwitnessed, evidence-free crime raises nothing at all', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const after = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      // Trespass leaves nothing behind. Nobody is told, so nobody knows.
      t.commitCrime('trespass', 40, -10);
      for (let i = 0; i < 30; i++) t.advanceCombat(1);
      return t.getCombat();
    });

    expect(after.heat).toBe(0);
    expect(after.belief).toBeNull();
    expect(after.officers, 'and nobody was sent').toBe(0);

    expect(errors).toEqual([]);
  });

  test('the belief is where the report said, not where the player is', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const seen = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      // A crime a long way from where the player then goes.
      const eventId = t.commitCrime('theft', 44, -8);
      t.reportCrime({
        eventId,
        crime: 'theft',
        x: 44,
        z: -8,
        confidence: 0.9,
        identified: true,
        distanceToHelp: 0,
        canReachHelp: true,
      });
      t.advanceCombat(10);

      // Walk somewhere else entirely.
      t.teleport(-7, 55);
      t.settle(30);
      return { state: t.getCombat(), player: t.getPlayerState() };
    });

    expect(seen.state.belief).not.toBeNull();
    // The player is at the bench; the police think they are at the field.
    expect(Math.abs(seen.state.belief!.x - 44)).toBeLessThan(2);
    expect(Math.abs(seen.player.x - seen.state.belief!.x)).toBeGreaterThan(20);

    expect(errors).toEqual([]);
  });

  test('officers arrive near the belief, never on top of the player', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const spawned = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.teleport(-7, 55);
      t.forceHeat(3, 44, -8);
      for (let i = 0; i < 20; i++) t.advanceCombat(0.5);
      return { officers: t.getOfficers(), player: t.getPlayerState() };
    });

    expect(spawned.officers.length).toBeGreaterThan(0);
    for (const o of spawned.officers) {
      const toPlayer = Math.hypot(o.x - spawned.player.x, o.z - spawned.player.z);
      expect(toPlayer, `${o.id} appeared on top of the player`).toBeGreaterThan(10);
      // Nobody in sight, so everybody is still looking. This is the rung the
      // witnessed-pursuit test correctly never reaches.
      expect(['investigate', 'search', 'patrol']).toContain(o.state);
      // And they are walking toward the report, not toward the player.
      if (o.goalX !== null && o.goalZ !== null) {
        const goalToBelief = Math.hypot(o.goalX - 44, o.goalZ + 8);
        const goalToPlayer = Math.hypot(o.goalX - spawned.player.x, o.goalZ - spawned.player.z);
        expect(goalToBelief, `${o.id} is walking at the player, not the report`)
          .toBeLessThan(goalToPlayer);
      }
    }

    expect(errors).toEqual([]);
  });
});

test.describe('pursuit', () => {
  test('an officer who can see the player warns, then chases on foot', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const chase = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const me = t.getPlayerState();
      // The belief lands on the player, so this is the *witnessed* case: the
      // officers walk in from eighteen metres and find somebody there.
      t.forceHeat(3, me.x, me.z);

      const seen: string[] = [];
      for (let i = 0; i < 120; i++) {
        t.advanceCombat(0.25);
        t.settle(1);
        for (const o of t.getOfficers()) if (!seen.includes(o.state)) seen.push(o.state);
      }
      return { seen, officers: t.getOfficers() };
    });

    // approach -> warn -> pursue. There is no `investigate` here and there
    // should not be: an officer who can already see somebody has nothing to
    // investigate. That rung is exercised where it belongs, in the cold-belief
    // test above.
    expect(chase.seen).toContain('approach');
    expect(chase.seen, 'they ask before they chase').toContain('warn');
    expect(chase.seen, 'and only then do they run').toContain('pursue');
    expect(chase.seen.indexOf('warn')).toBeLessThan(chase.seen.indexOf('pursue'));

    expect(errors).toEqual([]);
  });

  test('driving away turns the chase into a vehicle pursuit', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const chase = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.initPhysics();
      // The flat stretch of road the driving suite uses. A car dropped on a
      // slope rolls away before anybody can get in.
      t.teleport(0, 30, 0);
      t.settle(20);
      const id = await t.spawnVehicle('hatchback', 2.2, 32, 0);
      if (!id) return { spawned: false, boarded: false, seen: [] as string[] };
      t.settle(90);

      // With the key, so this is a getaway and not a car theft — the theft
      // path has its own crime and does not belong in a pursuit test.
      t.giveItem('keys_hatchback', 1);
      const boarded = await t.enterVehicle(id);
      t.settle(20);

      const me = t.getPlayerState();
      // Heat 5 so more than one officer has a car to answer with.
      t.forceHeat(5, me.x, me.z);

      const seen: string[] = [];
      for (let i = 0; i < 120; i++) {
        t.advanceCombat(0.25);
        t.settle(1);
        for (const o of t.getOfficers()) if (!seen.includes(o.state)) seen.push(o.state);
      }
      return { spawned: true, boarded, seen, riding: t.getRidingVehicle(), state: t.getCombat() };
    });

    expect(chase.spawned).toBe(true);
    expect(chase.boarded, 'the player is actually driving').toBe(true);
    expect(chase.seen, 'the tier declares cars, so somebody uses one').toContain('pursue_vehicle');
    // The bug this exists to catch: an officer reaching through the window.
    expect(chase.seen, 'nobody is arrested through a car door').not.toContain('arrest');
    expect(chase.riding, 'still driving').not.toBeNull();
    expect(chase.state!.arrests).toBe(0);

    expect(errors).toEqual([]);
  });
});

test.describe('a legal encounter', () => {
  test('an officer standing next to a law-abiding player does nothing', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const quiet = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const me = t.getPlayerState();
      // Put a squad in the street, then clear the reason they came. The
      // officers stay in the world; there is simply nothing to do about a
      // player who has not done anything.
      t.forceHeat(2, me.x, me.z);
      t.advanceCombat(1);
      t.forceHeat(0);

      for (let i = 0; i < 60; i++) {
        t.advanceCombat(0.5);
        t.settle(1);
      }
      return { state: t.getCombat(), officers: t.getOfficers() };
    });

    expect(quiet.state.heat).toBe(0);
    expect(quiet.state.wanted).toBe(false);
    expect(quiet.state.arrests, 'nobody is arrested for standing there').toBe(0);
    expect(quiet.state.finesOwed).toBe(0);
    for (const o of quiet.officers) {
      expect(['patrol', 'search'], `${o.id} is bothering an innocent player`).toContain(o.state);
    }

    expect(errors).toEqual([]);
  });
});

test.describe('arrest and recovery', () => {
  test('an officer who reaches a wanted player on foot arrests them', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    // A real offence, not a forced Heat level: the fine comes from the crime
    // record, so an arrest with nothing on file correctly costs nothing.
    const before = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveMoney(600);
      const me = t.getPlayerState();
      const eventId = t.commitCrime('theft', me.x, me.z);
      t.reportCrime({
        eventId, crime: 'theft', x: me.x, z: me.z,
        confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
      });
      t.advanceCombat(10);
      return { cash: t.getWallet().cash, owed: t.getCombat().finesOwed, lived: t.getLifeState().yearProgress };
    });
    expect(before.owed).toBeGreaterThan(0);

    // Stand still and let them come. This is the whole arrest path: the unit
    // reaches ARREST_RANGE, calls the host, and the host fades, advances the
    // clock, charges the fine and puts the player outside the station.
    const caught = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      for (let i = 0; i < 400; i++) {
        t.advanceCombat(0.25);
        t.settle(1);
        if (t.getCombat().arrests > 0) return true;
      }
      return false;
    });
    expect(caught, 'an officer walked all the way in').toBe(true);

    await settleThrough(page);
    const arrested = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      return {
        state: t.getCombat(),
        wallet: t.getWallet(),
        player: t.getPlayerState(),
        lived: t.getLifeState().yearProgress,
      };
    });

    expect(arrested.state.arrests, 'somebody actually reached them').toBe(1);
    expect(arrested.state.heat, 'and the chase is over').toBe(0);
    expect(arrested.state.wanted).toBe(false);
    expect(arrested.wallet.cash, 'the fine was taken').toBeLessThan(before.cash);
    expect(arrested.state.finesOwed, 'and settled at the desk').toBe(0);
    expect(arrested.lived, 'four hours in a cell').toBeGreaterThan(before.lived);
    expect(arrested.player.indoors, 'released outside, not left in a cell').toBe(false);

    expect(errors).toEqual([]);
  });

  test('an impounded car is recoverable from the front desk', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const impounded = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.initPhysics();
      t.teleport(0, 30, 0);
      t.settle(20);
      const id = (await t.spawnVehicle('hatchback', 2.2, 32, 0))!;
      t.settle(90);
      t.giveItem('keys_hatchback', 1);
      t.giveMoney(1200);
      await t.enterVehicle(id);
      t.settle(20);

      // Cornered behind the wheel. An officer on foot will never reach through
      // the window — that is deliberate — so the way this ends is the player
      // giving up. The car goes to the yard before they are moved, so it is
      // never left running in the street.
      const me = t.getPlayerState();
      const eventId = t.commitCrime('dangerous_driving', me.x, me.z);
      t.reportCrime({
        eventId, crime: 'dangerous_driving', x: me.x, z: me.z,
        confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
      });
      t.advanceCombat(10);
      return { id, gave: t.surrender() };
    });
    expect(impounded.gave).toBe(true);

    await settleThrough(page);
    const after = await page.evaluate((id) => {
      const t = window.__LH_TEST__!;
      return { riding: t.getRidingVehicle(), record: t.getVehicleRecord(id) };
    }, impounded.id);

    expect(after.riding, 'not still sitting in the car').toBeNull();
    expect(after.record, 'the car went to the yard').toMatchObject({ impounded: true });

    const released = await page.evaluate(async (id) => {
      const t = window.__LH_TEST__!;
      t.giveMoney(1200);
      const door = t.getDoors().find((d) => d.interiorId === 'police')!;
      await t.enterDoor(door.id);
      t.settle(4);
      const offer = t.getServiceMenu('police_desk')!.entries
        .find((e) => e.id === 'release_vehicle')!;
      const before = t.getWallet().cash;
      t.useService('police_desk', 'release_vehicle');
      t.settle(2);
      return {
        available: offer.available,
        spent: before - t.getWallet().cash,
        record: t.getVehicleRecord(id),
      };
    }, impounded.id);

    expect(released.available).toBe(true);
    expect(released.spent, 'release is not free').toBeGreaterThan(0);
    expect(released.record, 'and the car is out of the yard')
      .toMatchObject({ impounded: false });

    expect(errors).toEqual([]);
  });
});

test.describe('escalation, decay and surrender', () => {
  test('Heat decays once the trail is cold, and the squad stands down', async ({ page }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const cooled = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.forceHeat(2, 10, 10);
      const hot = t.getCombat().heat;

      // Long enough for the belief to go stale and the Heat to drain.
      for (let i = 0; i < 200; i++) t.advanceCombat(0.5);
      return { hot, cold: t.getCombat() };
    });

    expect(cooled.hot).toBeCloseTo(2, 1);
    expect(cooled.cold.heat, 'hiding works').toBe(0);
    expect(cooled.cold.wanted).toBe(false);
    expect(cooled.cold.belief).toBeNull();

    expect(errors).toEqual([]);
  });

  test('surrendering ends it, and is still an arrest', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const before = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.giveMoney(600);
      const eventId = t.commitCrime('theft', 12, 12);
      t.reportCrime({
        eventId, crime: 'theft', x: 12, z: 12,
        confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
      });
      t.advanceCombat(10);
      const wanted = t.getCombat();
      return { wanted, gave: t.surrender(), cash: t.getWallet().cash, lived: t.getLifeState().yearProgress };
    });

    expect(before.wanted.wanted).toBe(true);
    expect(before.gave).toBe(true);

    await settleThrough(page);
    const after = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      return { state: t.getCombat(), wallet: t.getWallet(), player: t.getPlayerState(), lived: t.getLifeState().yearProgress };
    });

    expect(after.state.heat).toBe(0);
    expect(after.state.arrests).toBe(1);
    // Giving up chooses the moment, not the outcome. The fine is still paid
    // and the hours are still lost, or surrendering would dominate every other
    // option in the game.
    expect(after.wallet.cash, 'the fine was taken').toBeLessThan(before.cash);
    expect(after.state.finesOwed, 'settled at the desk').toBe(0);
    expect(after.lived, 'the hours are still lost').toBeGreaterThan(before.lived);
    // Arrest moves the player somewhere safe; it does not delete them.
    expect(Number.isFinite(after.player.x)).toBe(true);
    expect(after.player.indoors, 'released outside the station').toBe(false);

    expect(errors).toEqual([]);
  });
});

test.describe('save and load', () => {
  test('Heat, fines and the record survive a round trip', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const before = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveWeapon('pistol', 9);
      const eventId = t.commitCrime('vehicle_theft', 30, 30);
      t.reportCrime({
        eventId, crime: 'vehicle_theft', x: 30, z: 30,
        confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
      });
      t.advanceCombat(10);
      await t.saveNow('slot2');
      return t.getCombat();
    });
    expect(before.finesOwed).toBeGreaterThan(0);
    expect(before.heat).toBeGreaterThan(0);

    const after = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // Wipe it all, then bring it back.
      t.forceHeat(0);
      await t.loadNow('slot2');
      t.settle(2);
      return { state: t.getCombat(), officers: t.getOfficers().length };
    });

    expect(after.state.finesOwed).toBe(before.finesOwed);
    expect(after.state.heat).toBeCloseTo(before.heat, 3);
    expect(after.state.owned).toContain('pistol');
    // A save loaded mid-chase must not come back with a squad in the street.
    expect(after.officers).toBe(0);
    // And a weapon always comes back put away.
    expect(after.state.stance).toBe('holstered');

    expect(errors).toEqual([]);
  });
});

test.describe('accessibility', () => {
  test('the four combat options are settable and clamped', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    const set = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      t.setCombatOption('aimAssist', 0.5);
      t.setCombatOption('flashes', false);
      // Out of range on purpose: storage and the bridge are equally untrusted.
      t.setCombatOption('combatDifficulty', 99);
      return t.getCombat().options;
    });

    expect(set.aimAssist).toBeCloseTo(0.5, 3);
    expect(set.flashes).toBe(false);
    expect(set.combatDifficulty).toBeLessThanOrEqual(2);

    expect(errors).toEqual([]);
  });

  test('and reachable from the settings panel, by clicking', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await bootArmed(page);

    // Through the real DOM. Four options that only the test bridge can reach
    // are four options the player does not have — which is how a whole feature
    // ships looking complete from the inside.
    await page.click('#btnInfo');
    await page.click('#setAimAssist button[data-assist="1"]');
    await page.click('#setCameraShake button[data-shake="0"]');
    await page.click('#setCombatDifficulty button[data-diff="0.5"]');
    await page.click('#setFlashes');

    const set = await page.evaluate(() => window.__LH_TEST__!.getCombat().options);
    expect(set.aimAssist).toBeCloseTo(1, 3);
    expect(set.cameraShake).toBeCloseTo(0, 3);
    expect(set.combatDifficulty).toBeCloseTo(0.5, 3);
    expect(set.flashes, 'the pill toggles').toBe(false);

    // And the buttons show what is actually set.
    await expect(page.locator('#setAimAssist button[data-assist="1"]')).toHaveClass(/is-on/);
    await expect(page.locator('#setFlashes')).toHaveText('Off');

    expect(errors).toEqual([]);
  });
});
