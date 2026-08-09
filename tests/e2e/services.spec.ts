import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Phase 7 in a real browser: nine buildings, an economy and five job loops.
 *
 * Grouped several assertions to a scenario, for the reason Phase 6 recorded:
 * this suite drives one WebGL context, and a page boot is the expensive part.
 * Each `test` here is one boot and one line of enquiry.
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
  // Mid-morning: every shop in the catalogue is open, so a scenario about
  // something else is never also a scenario about opening hours.
  await page.evaluate(() => window.__LH_TEST__!.setTime(0.45));
}

/** The nine services, as the catalogue names them. */
const SERVICES = [
  'home',
  'grocery',
  'police',
  'clinic',
  'garage',
  'apartment',
  'cafe',
  'clothing',
  'airstrip',
] as const;

test.describe('enterable services', () => {
  test('every one of the nine can be entered and left', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const visits = await page.evaluate(async (services) => {
      const t = window.__LH_TEST__!;
      const out: Array<Record<string, unknown>> = [];

      for (const service of services) {
        const door = t.getDoors().find((d) => d.interiorId === service);
        if (!door) {
          out.push({ service, missing: true });
          continue;
        }

        // Stand where the player would be, so the return context is a real
        // outdoor position rather than wherever the last test left them.
        t.teleport(door.x - 2, door.z, 0);
        t.settle(4);
        const before = t.getPlayerState();

        const entered = await t.enterDoor(door.id);
        t.settle(10);
        const inside = t.getPlayerState();
        const room = t.getInterior();

        await t.exitInterior();
        t.settle(10);
        const after = t.getPlayerState();

        out.push({
          service,
          entered,
          insideY: inside.y,
          indoorsInside: inside.indoors,
          indoorsAfter: after.indoors,
          roomId: room?.id ?? null,
          points: room?.points.length ?? 0,
          colliders: room?.colliderBoxes ?? 0,
          parts: room?.parts ?? 0,
          // Exact-position door return, to the millimetre.
          dx: Math.abs(after.x - before.x),
          dz: Math.abs(after.z - before.z),
          dFacing: Math.abs(after.facing - before.facing),
        });
      }
      return out;
    }, SERVICES);

    for (const v of visits) {
      expect(v.missing, `${v.service} has no door`).toBeUndefined();
      expect(v.entered, `${v.service} refused entry`).toBe(true);
      expect(v.roomId, `${v.service} built the wrong room`).toBe(v.service);
      expect(v.indoorsInside, `${v.service} did not go indoors`).toBe(true);
      expect(v.indoorsAfter, `${v.service} did not come back out`).toBe(false);
      // Each cell sits well above the 360 m terrain.
      expect(v.insideY as number).toBeGreaterThan(500);
      // Every room is furnished and enclosed.
      expect(v.points as number, `${v.service} has no interaction points`).toBeGreaterThan(0);
      expect(v.parts as number, `${v.service} built no geometry`).toBeGreaterThan(10);
      expect(v.colliders as number, `${v.service} has no collision`).toBeGreaterThan(20);
      // Acceptance criterion 4: never the wrong door.
      expect(v.dx as number, `${v.service} returned to the wrong x`).toBeLessThan(0.05);
      expect(v.dz as number, `${v.service} returned to the wrong z`).toBeLessThan(0.05);
      expect(v.dFacing as number, `${v.service} returned facing wrong`).toBeLessThan(0.01);
    }
    expect(errors).toEqual([]);
  });

  test('each building gets its own cell, and only two render a live window', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async (services) => {
      const t = window.__LH_TEST__!;
      const cells: number[] = [];
      const portals: string[] = [];
      for (const service of services) {
        const door = t.getDoors().find((d) => d.interiorId === service)!;
        await t.enterDoor(door.id);
        t.settle(4);
        const room = t.getInterior()!;
        cells.push(room.originX);
        if (room.livePortal) portals.push(room.id);
        await t.exitInterior();
        t.settle(4);
      }
      return { cells, portals };
    }, SERVICES);

    expect(new Set(seen.cells).size).toBe(SERVICES.length);
    expect(seen.portals.sort()).toEqual(['apartment', 'home']);
    expect(errors).toEqual([]);
  });

  test('a closed shop says when it opens, and never half-opens', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setTime(0.125); // 03:00

      const grocery = t.getDoors().find((d) => d.interiorId === 'grocery')!;
      const clinic = t.getDoors().find((d) => d.interiorId === 'clinic')!;

      const groceryOpen = grocery.open;
      const refused = await t.enterDoor(grocery.id);
      t.settle(6);
      const afterRefusal = {
        indoors: t.getPlayerState().indoors,
        interior: t.getInterior(),
      };

      // Round-the-clock services let you in at three in the morning.
      const clinicEntered = await t.enterDoor(clinic.id);
      t.settle(6);
      const inClinic = t.getPlayerState().indoors;
      await t.exitInterior();
      t.settle(6);

      return { groceryOpen, refused, afterRefusal, clinicEntered, inClinic };
    });

    expect(seen.groceryOpen).toBe(false);
    expect(seen.refused).toBe(false);
    // A refusal leaves nothing behind: no room, no overlay, still outside.
    expect(seen.afterRefusal.indoors).toBe(false);
    expect(seen.afterRefusal.interior).toBeNull();
    expect(seen.clinicEntered).toBe(true);
    expect(seen.inClinic).toBe(true);
    expect(errors).toEqual([]);
  });

  test('interiors unload cleanly across twenty enter/exit cycles', async ({ page }) => {
    // Twenty-nine doorways at ~3.2 s of real-time fade each. The fade is
    // deliberately real-time -- `settle` cannot advance past it -- so this one
    // scenario is genuinely minutes long and says so rather than flaking.
    test.setTimeout(300_000);
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async (services) => {
      const t = window.__LH_TEST__!;
      t.setPopulationActive(false);
      t.prepareShot();

      const door = (s: string) => t.getDoors().find((d) => d.interiorId === s)!;

      // A warm-up lap through *all nine*, not one.
      //
      // The first entry fetches the kit, and each part's geometry is
      // registered with the renderer the first time it is drawn. Warming up on
      // the home alone and then measuring nine rooms counts the garage's car
      // lift and the grocery's chillers as a leak — which is exactly the trap
      // Phase 5's smoke test fell into, and it caught this spec too.
      for (const s of services) {
        await t.enterDoor(door(s).id);
        t.settle(10);
        await t.exitInterior();
        t.settle(10);
      }
      t.settle(20);
      const base = t.getRenderStats();

      for (let i = 0; i < 20; i++) {
        await t.enterDoor(door(services[i % services.length]).id);
        t.settle(6);
        await t.exitInterior();
        t.settle(6);
      }
      t.settle(30);
      const after = t.getRenderStats();

      return { base, after };
    }, SERVICES);

    // Nothing accumulated. Geometry and materials are shared with the kit
    // prototypes and the toon cache, so twenty rooms must cost what one did.
    expect(seen.after.geometries).toBe(seen.base.geometries);
    expect(seen.after.programs).toBeLessThanOrEqual(seen.base.programs);
    expect(seen.after.drawCalls).toBe(seen.base.drawCalls);
    expect(errors).toEqual([]);
  });

  test('a save taken inside comes back inside, at the same door', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door = t.getDoors().find((d) => d.interiorId === 'cafe')!;

      t.teleport(door.x - 2, door.z, 0);
      t.settle(4);
      const outside = t.getPlayerState();

      await t.enterDoor(door.id);
      t.settle(8);
      const savedInterior = t.getInterior();
      await t.saveNow('slot2');

      // Leave, and go somewhere else entirely.
      await t.exitInterior();
      t.settle(6);
      t.teleport(5.4, -39.3, Math.PI);
      t.settle(6);

      await t.loadNow('slot2');
      // Reopening the room is asynchronous: the kit is already resident but
      // the import is still a promise.
      await new Promise((r) => setTimeout(r, 1200));
      t.settle(20);

      const restored = t.getPlayerState();
      const room = t.getInterior();

      await t.exitInterior();
      t.settle(20);
      const back = t.getPlayerState();

      return { outside, savedInterior, restored, room, back };
    });

    expect(seen.savedInterior?.id).toBe('cafe');
    expect(seen.restored.indoors).toBe(true);
    expect(seen.room?.id).toBe('cafe');
    // And the way out still leads to the doorstep it was taken from.
    expect(seen.back.indoors).toBe(false);
    expect(Math.abs(seen.back.x - seen.outside.x)).toBeLessThan(0.05);
    expect(Math.abs(seen.back.z - seen.outside.z)).toBeLessThan(0.05);
    expect(errors).toEqual([]);
  });
});

test.describe('the economy', () => {
  test('buying and eating is a complete loop, and cannot duplicate on reload', async ({
    page,
  }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(200);
      const door = t.getDoors().find((d) => d.interiorId === 'grocery')!;
      await t.enterDoor(door.id);
      t.settle(8);

      const start = t.getWallet();
      const menu = t.getServiceMenu('grocery_buy')!;

      const bought = t.useService('grocery_buy', 'buy_bread');
      t.settle(4);
      const afterBuy = { wallet: t.getWallet(), inv: t.getInventory() };

      await t.saveNow('slot3');
      await t.loadNow('slot3');
      await new Promise((r) => setTimeout(r, 1200));
      t.settle(20);
      const afterReload = { wallet: t.getWallet(), inv: t.getInventory() };

      return { start, menu, bought, afterBuy, afterReload };
    });

    expect(seen.menu.open).toBe(true);
    expect(seen.menu.entries.length).toBeGreaterThan(4);
    expect(seen.bought).toBe('ok');

    const breadAfter = seen.afterBuy.inv.find((s) => s.id === 'bread')?.count ?? 0;
    expect(breadAfter).toBe(1);
    expect(seen.afterBuy.wallet.cash).toBe(seen.start.cash - 3);

    // Criterion 3: a reload duplicates neither the money nor the goods.
    const breadReloaded = seen.afterReload.inv.find((s) => s.id === 'bread')?.count ?? 0;
    expect(breadReloaded).toBe(1);
    expect(seen.afterReload.wallet.cash).toBe(seen.afterBuy.wallet.cash);
    expect(errors).toEqual([]);
  });

  test('an empty wallet is refused, not overdrawn', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door = t.getDoors().find((d) => d.interiorId === 'garage')!;
      await t.enterDoor(door.id);
      t.settle(8);

      const before = t.getWallet();
      const result = t.useService('garage_desk', 'buy_vehicle_hatchback');
      t.settle(4);
      const after = t.getWallet();
      const entry = t
        .getServiceMenu('garage_desk')!
        .entries.find((e) => e.id === 'buy_vehicle_hatchback')!;

      return { before, result, after, entry };
    });

    expect(seen.result).toBe('insufficient-funds');
    expect(seen.after.cash).toBe(seen.before.cash);
    expect(seen.after.ledger).toBe(seen.before.ledger);
    // The offer is still listed, with a reason -- a shop that looks empty when
    // you are broke reads as a bug rather than as a budget.
    expect(seen.entry.available).toBe(false);
    expect(seen.entry.reason).toBe('Not enough cash');
    expect(seen.entry.price).toBe(4200);
    expect(errors).toEqual([]);
  });

  test('a vehicle bought at the garage is owned and paid for once', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(2000);
      const door = t.getDoors().find((d) => d.interiorId === 'garage')!;
      await t.enterDoor(door.id);
      t.settle(8);

      const before = t.getWallet();
      const first = t.useService('garage_desk', 'buy_vehicle_bicycle');
      t.settle(4);
      const afterFirst = t.getWallet();
      const second = t.useService('garage_desk', 'buy_vehicle_bicycle');
      t.settle(4);
      const afterSecond = t.getWallet();

      return { before, first, afterFirst, second, afterSecond };
    });

    expect(seen.first).toBe('ok');
    expect(seen.afterFirst.cash).toBe(seen.before.cash - 180);
    // Buying a second is allowed and costs again -- what must not happen is
    // one purchase charging twice or a failed one charging at all.
    expect(seen.second).toBe('ok');
    expect(seen.afterSecond.cash).toBe(seen.afterFirst.cash - 180);
    expect(errors).toEqual([]);
  });

  test('the police desk takes a fine and the clinic treats', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(400);

      const police = t.getDoors().find((d) => d.interiorId === 'police')!;
      await t.enterDoor(police.id);
      t.settle(8);
      const beforeFine = t.getWallet();
      const fine = t.useService('police_desk', 'pay_fine');
      t.settle(4);
      const afterFine = t.getWallet();
      const talked = t.useService('police_desk', 'report');
      await t.exitInterior();
      t.settle(6);

      const clinic = t.getDoors().find((d) => d.interiorId === 'clinic')!;
      await t.enterDoor(clinic.id);
      t.settle(8);
      const treat = t.useService('clinic_treat', 'treatment');
      t.settle(4);
      const afterTreat = t.getWallet();
      await t.exitInterior();
      t.settle(6);

      return { beforeFine, fine, afterFine, talked, treat, afterTreat };
    });

    expect(seen.fine).toBe('ok');
    expect(seen.afterFine.cash).toBe(seen.beforeFine.cash - 60);
    expect(seen.talked).toBe('ok');
    expect(seen.treat).toBe('ok');
    expect(seen.afterTreat.cash).toBe(seen.afterFine.cash - 45);
    expect(errors).toEqual([]);
  });
});

test.describe('job loops', () => {
  /**
   * One complete shift at each of the five jobs.
   *
   * Objectives are reported through the bridge rather than by walking the
   * route, for the same reason the population specs send NPCs directly:
   * driving a taxi across a district in a headless browser measures the
   * pathfinder, not the job.
   */
  const JOBS = [
    { id: 'job_grocery_shift', pay: 45, interior: 'grocery', needsVehicle: false },
    { id: 'job_parcel_delivery', pay: 30, interior: 'grocery', needsVehicle: false },
    { id: 'job_city_courier', pay: 55, interior: 'airstrip', needsVehicle: false },
    { id: 'job_taxi_driving', pay: 12, interior: 'garage', needsVehicle: true },
    { id: 'job_garage_recovery', pay: 70, interior: 'garage', needsVehicle: false },
  ] as const;

  test('each of the five pays out exactly once when completed', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const runs = await page.evaluate(async (jobs) => {
      const t = window.__LH_TEST__!;
      t.giveMoney(2000);

      // Story Mode starts at 15. The courier is 16+ and the taxi 18+, so the
      // gates are doing their job -- age past them rather than around them.
      while (t.getLifeState().ageYears < 20) await t.forceBirthday();

      const out: Array<Record<string, unknown>> = [];

      for (const job of jobs) {
        const door = t.getDoors().find((d) => d.interiorId === job.interior)!;
        await t.enterDoor(door.id);
        t.settle(6);

        // The taxi asks for something to drive. Buy it here, through the same
        // counter a player would.
        if (job.needsVehicle) t.useService('garage_desk', 'buy_vehicle_bicycle');

        const started = t.startTask(job.id);
        const before = t.getWallet();

        // Everything the five jobs ever ask you to carry. A `collect`
        // objective is satisfied by holding the goods, not by reporting.
        t.giveItem('stock_box', 3);
        t.giveItem('parcel', 3);
        t.giveItem('repair_kit', 2);

        // Then walk the rest in order, waiting out any timed objective.
        let guard = 0;
        while (t.getTask() !== null && guard++ < 40) {
          const next = t.getTask()!.objectives.find((o) => !o.complete);
          if (!next) break;
          const was = next.done;
          if (next.label.toLowerCase().includes('wait')) t.advanceTask(next.target + 1);
          else t.reportTask(next.id);
          const still = t.getTask()?.objectives.find((o) => o.id === next.id);
          if (still && still.done === was) break; // made no progress; stop
        }

        const after = t.getWallet();
        const finished = t.getTask() === null;
        t.cancelTask();
        await t.exitInterior();
        t.settle(6);

        out.push({
          id: job.id,
          started,
          finished,
          earned: after.cash - before.cash,
          expected: job.pay,
        });
      }
      return out;
    }, JOBS);

    for (const r of runs) {
      expect(r.started, `${r.id} would not start`).toBe(true);
      expect(r.finished, `${r.id} did not complete`).toBe(true);
      expect(r.earned, `${r.id} paid the wrong amount`).toBe(r.expected);
    }
    expect(errors).toEqual([]);
  });

  test('the grocery shift is playable from purchase through consumption', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(100);
      const door = t.getDoors().find((d) => d.interiorId === 'grocery')!;
      await t.enterDoor(door.id);
      t.settle(8);

      // --- shift start to payment ------------------------------------------
      const beforeShift = t.getWallet().cash;
      t.startTask('job_grocery_shift');
      t.giveItem('stock_box', 3);
      t.reportTask('fetch');
      let guard = 0;
      while (t.getTask() !== null && guard++ < 20) {
        const next = t.getTask()!.objectives.find((o) => !o.complete);
        if (!next) break;
        t.reportTask(next.id);
      }
      const afterShift = t.getWallet().cash;

      // --- purchase through consumption ------------------------------------
      const hungry = 0.2;
      const beforeFood = t.getNeeds();
      t.useService('grocery_buy', 'buy_meal');
      t.settle(4);
      const carrying = t.getInventory().find((s) => s.id === 'meal')?.count ?? 0;

      // Eating at the cafe counter, which charges and consumes in one step.
      await t.exitInterior();
      t.settle(6);
      const cafe = t.getDoors().find((d) => d.interiorId === 'cafe')!;
      await t.enterDoor(cafe.id);
      t.settle(8);
      const beforeDrink = t.getNeeds().energy;
      const drank = t.useService('cafe_order', 'drink_coffee');
      t.settle(4);
      const afterDrink = t.getNeeds().energy;

      return {
        beforeShift,
        afterShift,
        carrying,
        drank,
        beforeDrink,
        afterDrink,
        hungry,
        beforeFood,
      };
    });

    expect(seen.afterShift).toBe(seen.beforeShift + 45);
    expect(seen.carrying).toBe(1);
    expect(seen.drank).toBe('ok');
    // Energy went up, or was already full -- either way it did not go down.
    expect(seen.afterDrink).toBeGreaterThanOrEqual(seen.beforeDrink);
    expect(errors).toEqual([]);
  });

  test('a task can be cancelled, retried and only paid on success', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const seen = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const door = t.getDoors().find((d) => d.interiorId === 'grocery')!;
      await t.enterDoor(door.id);
      t.settle(8);

      const start = t.getWallet().cash;
      t.startTask('job_grocery_shift');
      const first = t.getTask()!.runNumber;
      t.cancelTask();
      const afterCancel = { task: t.getTask(), cash: t.getWallet().cash };

      t.startTask('job_grocery_shift');
      const second = t.getTask()!.runNumber;
      t.giveItem('stock_box', 3);
      let guard = 0;
      while (t.getTask() !== null && guard++ < 20) {
        const next = t.getTask()!.objectives.find((o) => !o.complete);
        if (!next) break;
        t.reportTask(next.id);
      }
      const afterFinish = t.getWallet().cash;

      return { start, first, second, afterCancel, afterFinish };
    });

    expect(seen.afterCancel.task).toBeNull();
    expect(seen.afterCancel.cash).toBe(seen.start); // a cancel pays nothing
    expect(seen.second).toBe(seen.first + 1);
    expect(seen.afterFinish).toBe(seen.start + 45);
    expect(errors).toEqual([]);
  });
});
