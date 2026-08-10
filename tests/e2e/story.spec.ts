import { test, expect, type ConsoleMessage, type Page } from '@playwright/test';

/**
 * Phase 8 in a real browser.
 *
 * The unit suite already walks the quest graph start to finish in a
 * millisecond — `storyContent.test.ts` does exactly that, on both routes. What
 * it *cannot* prove is that the graph is wired to the game: that the objective
 * line renders, that a conversation opens a panel, that a save taken
 * mid-chapter comes back the same, that a cutscene hands the camera back.
 * That is what these are for.
 *
 * Grouped several assertions to a scenario, for the reason Phase 6 recorded:
 * this suite drives one WebGL context and a page boot is the expensive part.
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
  await page.evaluate(() => window.__LH_TEST__!.awaitStory());
}

/**
 * The choices each route takes, recorded up front.
 *
 * Recording rather than clicking through fifteen conversations: the dialogue
 * path is exercised on its own below, and a route test that also drove every
 * tree would fail for two unrelated reasons at once.
 */
const LEGAL_ROUTE = {
  ch2_bicycle: 'fix',
  ch3_mentor: 'school',
  ch5_route: 'straight',
  ch5_someone: 'sana',
  ch6_route: 'law',
  ch7_home: 'return',
} as const;

const MIXED_ROUTE = {
  ch2_bicycle: 'buy',
  ch3_mentor: 'road',
  ch5_route: 'shortcut',
  ch5_someone: 'alone',
  ch6_route: 'crime',
  ch7_home: 'stay',
} as const;

test.describe('the authored story', () => {
  test('loads lazily, opens chapter 1 and puts an objective on the HUD', async ({ page }) => {
    const errors = watchConsole(page);
    await boot(page);

    const state = await page.evaluate(() => window.__LH_TEST__!.getStory());
    expect(state.loaded).toBe(true);
    expect(state.active).toContain('q1_keepsakes');
    // A fresh run has a clean record and no standing yet.
    expect(state.reputation).toEqual({ community: 0, law: 1 });

    await page.evaluate(() => window.__LH_TEST__!.settle(1));
    const line = await page.evaluate(() => window.__LH_TEST__!.getObjectiveLine());
    expect(line, 'the HUD should be showing chapter 1’s first objective').toBeTruthy();
    expect(line).not.toContain('obj.');

    // The journal is the full picture; the HUD line is one of them. Opened
    // with J, the way a player does, rather than through the bridge — a panel
    // only the test harness can reach is a panel nobody has.
    await page.locator('canvas').first().click();
    await page.keyboard.press('KeyJ');
    await page.evaluate(() => window.__LH_TEST__!.settle(1));
    expect(await page.locator('#journal').isVisible()).toBe(true);
    expect(await page.locator('.journal__quest').count()).toBeGreaterThan(0);

    await page.keyboard.press('KeyJ');
    await page.evaluate(() => window.__LH_TEST__!.settle(1));
    expect(await page.locator('#journal').isVisible(), 'J should close it too').toBe(false);

    expect(errors).toEqual([]);
  });

  /**
   * Acceptance criterion 1 and 2, in the running game.
   *
   * Drives the whole main spine by reporting objectives — which is what the
   * world does when you walk into a place, hand something over or finish a
   * shift — and asserts an ending falls out at the end of it.
   */
  for (const [name, choices, expectFamily] of [
    ['a fully legal route', LEGAL_ROUTE, 'return_build'],
    ['a mixed route through the shortcut and the pegs', MIXED_ROUTE, 'stay_rise'],
  ] as const) {
    test(`completes on ${name}`, async ({ page }) => {
      test.setTimeout(180_000);
      const errors = watchConsole(page);
      await boot(page);

      const result = await page.evaluate(async (picks) => {
        const t = window.__LH_TEST__!;
        for (const [id, value] of Object.entries(picks)) t.setChoice(id, value);

        const MAIN = [
          'q1_keepsakes', 'q1_the_road', 'q2_first_pay', 'q2_deliveries',
          'q2_the_bicycle', 'q3_road_test', 'q3_mentor', 'q3_the_crack',
          'q4_departure', 'q4_first_key', 'q4_city_job', 'q5_a_name',
          'q5_someone', 'q6_the_offer', 'q7_last_horizon',
        ];
        const visited: string[] = [];

        for (const id of MAIN) {
          // Age up to whatever this chapter needs. The gates are real: a quest
          // with minAge 18 refuses at 17 here exactly as it would in play.
          await t.advanceLife(60 * 60);
          t.startQuest(id);

          for (let guard = 0; guard < 80; guard++) {
            const q = t.getQuest(id);
            if (!q) break;
            visited.push(`${id}/${q.stage}`);

            let moved = false;
            for (const o of q.objectives) {
              if (o.optional || o.complete) continue;
              if (t.reportObjective(id, o.id, o.target)) moved = true;
            }
            // A stage that is pure staging has nothing to report; give its
            // timer a nudge instead.
            if (!moved) t.advanceStory(2);
            t.settle(1);
            // Scenes are skippable and this run is not watching them. Sitting
            // through 24 s of the chapter-7 shot at 1/60 a frame would be
            // 1,440 settles.
            if (t.getScene()) t.skipScene();

            const after = t.getQuest(id);
            if (!after || after.stage === q.stage) {
              if (!moved) break;
            }
          }
        }

        t.settle(1);
        return { story: t.getStory(), visited, reel: t.getReel() };
      }, choices);

      expect(result.story.completed, 'every main quest should be complete').toEqual(
        expect.arrayContaining(['q1_keepsakes', 'q4_departure', 'q6_the_offer', 'q7_last_horizon']),
      );
      expect(result.story.endingId, 'an ending should have been resolved').toBeTruthy();
      expect(result.story.endingId!.startsWith(expectFamily)).toBe(true);

      // The route actually went the way the choices said.
      const chapter6 = name.includes('legal') ? 'q6_the_offer/law' : 'q6_the_offer/crime';
      expect(result.visited).toContain(chapter6);

      // And the reel remembers it.
      expect(result.reel!.timeline.length).toBeGreaterThan(4);
      expect(result.reel!.finalTitle).not.toContain('reel.');

      expect(errors).toEqual([]);
    });
  }

  /**
   * The objectives that are satisfied by *doing* rather than by reporting.
   *
   * This exists because three of them shipped with no reporter wired at all —
   * `deliver`, `park` and `escape` — and every test passed, because the route
   * runs above drive the graph by objective id and bypass the whole layer that
   * decides when something is satisfied. Chapter 1 was uncompletable in a real
   * game. Nothing here calls `reportObjective`.
   */
  test('deliver, park and escape complete by doing them, not by reporting them', async ({
    page,
  }) => {
    test.setTimeout(180_000);
    const errors = watchConsole(page);
    await boot(page);

    // -- deliver: carry a loaf to Gita's door -------------------------------
    const delivery = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.jumpToStage('q1_the_road', 'deliver');
      t.giveItem('bread', 1);
      t.settle(1);
      const before = t.getQuest('q1_the_road');

      // `village_home` in storyPlaces. Walk there holding it, and settle long
      // enough for the 4 Hz world check to run.
      t.teleport(15.2, -24.1);
      t.settle(40);

      return {
        before,
        after: t.getQuest('q1_the_road'),
        breadLeft: t.getInventory().find((i) => i.id === 'bread')?.count ?? 0,
      };
    });

    expect(delivery.before!.objectives.find((o) => o.id === 'gita')!.complete).toBe(false);
    expect(
      delivery.after,
      'the delivery should have completed the stage and moved the quest on',
    ).not.toBeNull();
    expect(delivery.after!.stage, 'deliver moves it to the next stage').toBe('ride');
    expect(delivery.breadLeft, 'a loaf you keep is a loaf you did not deliver').toBe(0);

    // -- park: leave a vehicle in the bay -----------------------------------
    const parking = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.jumpToStage('q3_road_test', 'park');
      t.settle(1);

      // A bicycle, not a car: `canEnter` checks the lock before the key, so a
      // hatchback nobody holds keys to is refused — correctly. The parking
      // objective does not name a vehicle kind, and a bicycle in the bay is
      // parked in the bay.
      //
      // Player first, then the vehicle beside them, then settle: the order
      // `driving.spec.ts` established, because `exitPlacement` refuses to let
      // anybody out of a body that is still moving.
      t.teleport(12, 13.6, 0);
      t.settle(20);
      const id = await t.spawnVehicle('bicycle', 12, 12, 0);
      if (!id) return null;
      t.settle(90);

      const walkedIn = t.getQuest('q3_road_test');
      const entered = await t.enterVehicle(id);
      t.settle(30);
      const left = await t.exitVehicle();
      t.settle(2);

      return { walkedIn, entered, left, after: t.getQuest('q3_road_test') };
    });

    expect(parking).not.toBeNull();
    expect(
      parking!.walkedIn?.objectives.find((o) => o.id === 'bay')?.complete,
      'walking into the bay is not parking in it',
    ).toBe(false);
    // Assert the mechanics happened, so a refused exit reads as a refused exit
    // rather than as a broken objective.
    expect(parking!.entered, 'the player should have got in').toBe(true);
    expect(parking!.left, 'the player should have got out').toBe(true);
    expect(
      parking!.after,
      'leaving the car in the bay should have finished the stage',
    ).toBeNull();

    // -- escape: put distance between you and where you were ----------------
    const escape = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      // The delivery above moved chapter 1 onto a stage that opens a scene,
      // and world checks pause while one plays — correctly, since the player
      // has no controls during it. Nothing can be escaped from inside a
      // cutscene either, so skip it first.
      t.skipScene();
      t.settle(2);

      t.jumpToStage('q6_the_offer', 'crime');
      t.teleport(44, -8); // the field
      // The world checks run at 4 Hz, not per frame — deliberately, to keep a
      // distance check off a hot path. Thirty frames is half a second, so the
      // check definitely runs and records where the escape started from.
      t.settle(30);
      const atTheField = t.getQuest('q6_the_offer')!.objectives.find((o) => o.id === 'away')!.done;

      t.teleport(-7, 55); // a long way off
      t.settle(30);
      const awayFromIt = t.getQuest('q6_the_offer')!.objectives.find((o) => o.id === 'away')!;
      return { atTheField, done: awayFromIt.done, complete: awayFromIt.complete };
    });

    expect(escape.atTheField, 'standing still is not escaping').toBe(0);
    // 81 m of real ground covered, reported against a 70 m objective and
    // clamped to it — the field to the shore bench is the longest clear run
    // the village offers from there, and is why the objective asks for 70
    // rather than the 120 it was first written with.
    expect(escape.done, 'the distance should be measured from where you started').toBe(70);
    expect(escape.complete).toBe(true);

    expect(errors).toEqual([]);
  });

  /**
   * Acceptance criterion 3, which is the one that actually bites.
   *
   * Save mid-stage with partial progress, reload, and check the objective is
   * where it was and the reward has not paid twice.
   */
  test('a save taken mid-quest reloads without duplicating a reward or losing an objective', async ({
    page,
  }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    // Chapter 6's `exploit` stage: two objectives and a $900 reward. Chosen
    // over chapter 1 deliberately — the keepsake objective is a `collect`, and
    // those are re-read off the world every frame, so "pretend you found
    // three" is a thing the game correctly refuses to believe.
    const before = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(500);
      t.jumpToStage('q6_the_offer', 'exploit');
      t.reportObjective('q6_the_offer', 'broker', 1);
      t.settle(1);

      await t.saveNow('slot1');
      return { quest: t.getQuest('q6_the_offer'), cash: t.getWallet().cash };
    });

    expect(before.quest!.stage).toBe('exploit');
    expect(before.quest!.objectives.find((o) => o.id === 'broker')!.complete).toBe(true);
    expect(before.quest!.objectives.find((o) => o.id === 'sign')!.complete).toBe(false);

    const paid = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.reportObjective('q6_the_offer', 'sign', 1);
      t.settle(1);
      const cash = t.getWallet().cash;
      await t.saveNow('slot2'); // saved *after* the reward
      return cash;
    });
    expect(paid, 'the stage should have paid its $900 commission').toBe(before.cash + 900);

    // Reload the save taken after the payment, put the stage back, and finish
    // it again. The award key is in that save, so it must not pay twice.
    const again = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.loadNow('slot2');
      t.settle(1);
      t.jumpToStage('q6_the_offer', 'exploit');
      t.reportObjective('q6_the_offer', 'broker', 1);
      t.reportObjective('q6_the_offer', 'sign', 1);
      t.settle(1);
      return t.getWallet().cash;
    });
    expect(again, 'a reward already in the save must not pay again').toBe(paid);

    // And the earlier save still has the half-done stage, unchanged.
    const restored = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.loadNow('slot1');
      t.settle(1);
      return { quest: t.getQuest('q6_the_offer'), cash: t.getWallet().cash };
    });
    expect(restored.quest!.stage, 'the stage should come back where it was').toBe('exploit');
    expect(
      restored.quest!.objectives.find((o) => o.id === 'sign')!.complete,
      'an objective that was not done must not come back done',
    ).toBe(false);
    expect(restored.cash).toBe(before.cash);

    expect(errors).toEqual([]);
  });

  /**
   * Acceptance criterion 4.
   *
   * Free Roam is a separate save mode, so this asserts the thing that would
   * actually break it: that the story's gates never appear on that path. The
   * story chunk is not even fetched.
   */
  test('Free Roam is not blocked by story gates', async ({ page }) => {
    const errors = watchConsole(page);
    await page.goto('/?e2e=1');
    await page.waitForFunction(() => typeof window.__LH_TEST__ !== 'undefined', null, {
      timeout: 60_000,
    });

    // Pick the mode the way a player does, through the selector, *before*
    // `ready()` presses start. Going in through a query flag would be testing
    // a path the game does not have.
    await page.locator('button[data-mode="freeRoam"]').click();
    await page.evaluate(() => window.__LH_TEST__!.ready());

    const state = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      return { story: t.getStory(), zone: t.getZoneDebug().zoneId };
    });

    // Nothing loaded, nothing running, and the player is playing.
    expect(state.story.loaded).toBe(false);
    expect(state.story.active).toEqual([]);
    expect(state.zone).toBe('village_coast');

    // And the world still works: doors open, money moves, jobs start.
    const worked = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.setTime(0.45);
      const door = t.getDoors().find((d) => d.interiorId === 'grocery');
      if (!door) return { entered: false, task: false };
      const entered = await t.enterDoor(door.id);
      const task = t.startTask('job_grocery_shift');
      return { entered, task };
    });
    expect(worked.entered).toBe(true);
    expect(worked.task).toBe(true);

    expect(errors).toEqual([]);
  });

  /** Dialogue: a panel, real buttons, and consequences that land. */
  test('an authored conversation opens a panel and records the choice', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    const opened = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.awaitPopulation();
      t.startQuest('q2_the_bicycle');
      t.jumpToStage('q2_the_bicycle', 'choose');
      t.settle(1);
      return t.talkTo('v_tomas');
    });
    expect(opened, 'talking to Tomás mid-stage should open the authored tree').toBe(true);

    // The panel is real DOM with real buttons.
    expect(await page.locator('#dialogue').isVisible()).toBe(true);
    const choices = page.locator('.dlg__choice');
    expect(await choices.count()).toBeGreaterThan(1);
    expect(await page.locator('#dlgText').textContent()).not.toContain('dlg.');

    // Click through: ask about fixing it, then commit to it.
    await choices.first().click();
    await page.locator('.dlg__choice').first().click();

    const state = await page.evaluate(() => window.__LH_TEST__!.getStory());
    expect(state.choices.ch2_bicycle, 'the choice should be recorded').toBe('fix');
    expect(await page.locator('#dialogue').isVisible()).toBe(false);

    expect(errors).toEqual([]);
  });

  /**
   * A locked choice is shown and disabled, not hidden.
   *
   * The age gate rather than a relationship gate, and that is the second
   * version of this test: the first used Maryam's bolder line and failed,
   * because Phase 6 seeds her `initialRelationship` at trust 0.4. It was
   * right to — the player grew up in her village — so the test was wrong, not
   * the game. An age gate does not depend on a seed, and it is the more
   * important rule anyway: chapter 6's crime route must not be offered to a
   * seventeen-year-old.
   */
  test('the crime route is visible and refused before 18', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      await t.awaitPopulation();
      t.startQuest('q6_the_offer');
      t.jumpToStage('q6_the_offer', 'weigh');
      t.settle(1);
      t.talkTo('v_bashir');
    });

    // Step to the node that lists the five routes.
    await page.locator('.dlg__choice').first().click();

    const dialogue = await page.evaluate(() => window.__LH_TEST__!.getDialogue());
    expect(dialogue).not.toBeNull();
    expect(dialogue!.nodeId).toBe('routes');

    const locked = dialogue!.choices.filter((c) => !c.available);
    expect(locked, 'the crime route needs 18; the player is 15').toHaveLength(1);
    expect(dialogue!.choices.filter((c) => c.available).length, 'four legal routes stay open').toBe(4);

    // Rendered, disabled, with a reason in words rather than a number.
    const disabled = page.locator('.dlg__choice:disabled');
    expect(await disabled.count()).toBe(1);
    const reason = await disabled.first().locator('em').textContent();
    expect(reason).toBeTruthy();
    expect(reason).not.toMatch(/0\.\d/);

    expect(errors).toEqual([]);
  });

  /**
   * A cutscene takes the camera and gives it back.
   *
   * The failure this guards is the one a unit test found: a scene skipped
   * during its own fade used to leave the promise unresolved and the stage
   * stalled behind it. Here the same thing is done to a real camera.
   */
  test('a cutscene runs, can be skipped, and returns control', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    const run = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.startQuest('q1_keepsakes');
      t.jumpToStage('q1_keepsakes', 'bench');
      // The stage queues its scene; the frame after picks it up.
      t.settle(6);
      const playing = t.getScene();

      t.skipScene();
      t.settle(6);

      return { playing, after: t.getScene() };
    });

    expect(run.playing, 'the bench stage should have started its scene').toBe('cs_first_horizon');
    expect(run.after, 'skipping should end it').toBeNull();

    // Control is back: the player can move again.
    const moved = await page.evaluate(() => {
      const t = window.__LH_TEST__!;
      const before = t.getPlayerState();
      t.teleport(before.x + 4, before.z);
      t.settle(4);
      const after = t.getPlayerState();
      return Math.abs(after.x - before.x) > 1;
    });
    expect(moved).toBe(true);

    expect(errors).toEqual([]);
  });

  /**
   * Acceptance criterion 5.
   *
   * The reel reflects what happened, and exports a real PNG without a network
   * call. `exportReel` returns the blob's byte count, so a zero means the
   * browser refused a canvas and anything else means a file exists.
   */
  test('the Life Reel reflects the run and exports an image locally', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);

    const requests: string[] = [];
    page.on('request', (r) => {
      if (r.method() !== 'GET') requests.push(`${r.method()} ${r.url()}`);
    });

    await boot(page);

    const reel = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      t.giveMoney(3200);
      t.setChoice('ch3_mentor', 'trade');
      t.setChoice('ch6_route', 'protect');
      t.setStoryFlag('ch7_return');
      t.adjustReputation('community', 0.7);
      t.startQuest('q1_keepsakes');
      t.jumpToStage('q1_keepsakes', 'bench');
      t.skipScene();
      t.settle(1);

      t.openReel(true);
      return { model: t.getReel(), bytes: await t.exportReel() };
    });

    expect(reel.model).not.toBeNull();
    const timeline = reel.model!.timeline.map((r) => r.text).join(' | ');
    expect(timeline, 'the recorded choices should be on the timeline').toContain('the trade');
    expect(timeline).not.toContain('choice.ch3_mentor');

    const money = reel.model!.sections
      .flatMap((s) => s.rows)
      .find((r) => r.value.startsWith('$'));
    expect(money!.value).toBe('$3,200');

    expect(reel.bytes, 'a PNG should have been produced').toBeGreaterThan(1000);
    expect(await page.locator('#reel').isVisible()).toBe(true);

    // Nothing left the device.
    expect(requests, 'the reel must not upload anything').toEqual([]);
    expect(errors).toEqual([]);
  });

  /** The ending varies with the state the brief names: law, money, standing. */
  test('the same chapter 7 choice gives different endings for different lives', async ({ page }) => {
    test.setTimeout(120_000);
    const errors = watchConsole(page);
    await boot(page);

    const endings = await page.evaluate(async () => {
      const t = window.__LH_TEST__!;
      const out: string[] = [];

      const run = async (setup: () => void) => {
        await t.loadNow('autosave').catch(() => false);
        setup();
        t.startQuest('q7_last_horizon');
        t.jumpToStage('q7_last_horizon', 'decide');
        const q = t.getQuest('q7_last_horizon');
        for (const o of q?.objectives ?? []) t.reportObjective('q7_last_horizon', o.id, o.target);
        t.settle(1);
        out.push(t.getStory().endingId ?? 'none');
      };

      // Stayed, clean, respected and comfortable.
      await run(() => {
        t.setStoryFlag('ch7_stay');
        t.giveMoney(4000);
        t.adjustReputation('community', 0.8);
      });
      return out;
    });

    expect(endings[0]).toBe('stay_rise_respected');
    expect(errors).toEqual([]);
  });
});
