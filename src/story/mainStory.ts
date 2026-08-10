import type { QuestDef } from './QuestDefinition';

/**
 * The seven chapters, ages 15 to 25.
 *
 * Two rules were held to while authoring, and both are checked by tests rather
 * than trusted:
 *
 * 1. **No main-story stage requires violent crime.** Every branch that leads
 *    through a crime has a sibling that does not, and `storyValidation` fails
 *    the build if a `main` quest carries a `combat` objective at all.
 * 2. **Every mission tests a mechanic.** The brief asks that missions
 *    introduce, combine or meaningfully test systems rather than act as
 *    filler, so each one below names the system it is about. "Go here, come
 *    back" appears exactly nowhere.
 *
 * | Chapter | Age | Main quests | Systems it puts under load |
 * | --- | --- | --- | --- |
 * | 1 | 15 | 2 | collectibles, interaction, dialogue |
 * | 2 | 16 | 3 | jobs, economy, inventory, relationships |
 * | 3 | 17 | 3 | vehicles, driving, parking, gates |
 * | 4 | 18 | 3 | zone travel, interiors, rent, city services |
 * | 5 | 19-21 | 2 | reputation branching, task difficulty, law record |
 * | 6 | 22-24 | 1 | every axis at once; five distinct routes |
 * | 7 | 25 | 1 | the ending resolver |
 */

// ---------------------------------------------------------------------------
// Chapter 1 — Age 15: "Five Things Left Behind"
// ---------------------------------------------------------------------------

/**
 * The prologue, built on the five keepsakes that already exist.
 *
 * Progress is *read off* `Collectibles.count` every frame rather than pushed
 * when one is picked up. Phase 7 learned that lesson on `collect` objectives:
 * items arrive from four sources and wiring each one is four chances to miss
 * a case. The truth of "you have found three" is how many you have found.
 */
const KEEPSAKES: QuestDef = {
  id: 'q1_keepsakes',
  titleKey: 'quest.q1_keepsakes.title',
  summaryKey: 'quest.q1_keepsakes.summary',
  kind: 'main',
  chapter: 1,
  mode: 'story',
  startStage: 'listen',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'listen',
      titleKey: 'stage.q1_keepsakes.listen',
      hintKey: 'hint.q1_keepsakes.listen',
      dialogueId: 'dlg_eleni_keepsakes',
      objectives: [
        { id: 'ask', kind: 'talk', labelKey: 'obj.q1_keepsakes.ask', npcId: 'v_eleni' },
      ],
      checkpoint: true,
      branches: [{ id: 'go', to: 'search' }],
    },
    {
      id: 'search',
      titleKey: 'stage.q1_keepsakes.search',
      hintKey: 'hint.q1_keepsakes.search',
      objectives: [
        {
          id: 'find',
          kind: 'collect',
          labelKey: 'obj.q1_keepsakes.find',
          itemId: 'keepsake',
          count: 5,
        },
        {
          id: 'hamid',
          kind: 'talk',
          labelKey: 'obj.q1_keepsakes.hamid',
          npcId: 'v_hamid',
          optional: true,
        },
      ],
      checkpoint: true,
      rewards: [{ id: 'found', money: 20 }],
      branches: [{ id: 'done', to: 'bench' }],
    },
    {
      id: 'bench',
      titleKey: 'stage.q1_keepsakes.bench',
      hintKey: 'hint.q1_keepsakes.bench',
      sceneId: 'cs_first_horizon',
      objectives: [
        { id: 'sit', kind: 'travel', labelKey: 'obj.q1_keepsakes.bench', place: 'village_bench' },
      ],
      onEnter: [{ kind: 'reel', event: 'keepsake', textKey: 'reel.q1.allfive' }],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q1_keepsakes.done',
          consequences: [
            { kind: 'flag', id: 'ch1_done' },
            { kind: 'reputation', axis: 'community', delta: 0.08 },
            { kind: 'startQuest', id: 'q1_the_road' },
          ],
        },
      ],
    },
  ],
};

/**
 * The idea that the road leads away, and the bicycle that makes it plausible.
 *
 * This is the chapter's *combining* mission: it puts the keepsake walk, the
 * grocery counter and the first vehicle in one line, so a player has touched
 * interaction, the economy and a vehicle before chapter 2 asks them to work.
 */
const THE_ROAD: QuestDef = {
  id: 'q1_the_road',
  titleKey: 'quest.q1_the_road.title',
  summaryKey: 'quest.q1_the_road.summary',
  kind: 'main',
  chapter: 1,
  mode: 'story',
  requires: ['q1_keepsakes'],
  startStage: 'errand',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'errand',
      titleKey: 'stage.q1_the_road.errand',
      hintKey: 'hint.q1_the_road.errand',
      dialogueId: 'dlg_maryam_errand',
      objectives: [
        { id: 'shop', kind: 'travel', labelKey: 'obj.q1_the_road.shop', place: 'grocery_counter' },
        { id: 'bread', kind: 'buy', labelKey: 'obj.q1_the_road.bread', itemId: 'bread' },
      ],
      checkpoint: true,
      branches: [{ id: 'home', to: 'deliver' }],
    },
    {
      id: 'deliver',
      titleKey: 'stage.q1_the_road.deliver',
      hintKey: 'hint.q1_the_road.deliver',
      objectives: [
        {
          id: 'gita',
          kind: 'deliver',
          labelKey: 'obj.q1_the_road.gita',
          place: 'village_home',
          itemId: 'bread',
        },
      ],
      rewards: [{ id: 'thanks', money: 12 }],
      checkpoint: true,
      branches: [{ id: 'on', to: 'ride' }],
    },
    {
      id: 'ride',
      titleKey: 'stage.q1_the_road.ride',
      hintKey: 'hint.q1_the_road.ride',
      sceneId: 'cs_the_road_out',
      objectives: [
        {
          id: 'ride',
          kind: 'drive',
          labelKey: 'obj.q1_the_road.ride',
          vehicleKind: 'bicycle',
          metres: 400,
        },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q1_the_road.done',
          consequences: [
            { kind: 'flag', id: 'ch1_road_seen' },
            { kind: 'completeChapter', id: 'chapter_1' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.1' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 2 — Age 16: "First Pay"
// ---------------------------------------------------------------------------

/** The economy mission: a full shift, and money that arrives once. */
const FIRST_PAY: QuestDef = {
  id: 'q2_first_pay',
  titleKey: 'quest.q2_first_pay.title',
  summaryKey: 'quest.q2_first_pay.summary',
  kind: 'main',
  chapter: 2,
  mode: 'story',
  minAge: 16,
  requires: ['q1_the_road'],
  startStage: 'ask',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'ask',
      titleKey: 'stage.q2_first_pay.ask',
      hintKey: 'hint.q2_first_pay.ask',
      dialogueId: 'dlg_maryam_job',
      objectives: [
        { id: 'ask', kind: 'talk', labelKey: 'obj.q2_first_pay.ask', npcId: 'v_maryam' },
      ],
      checkpoint: true,
      branches: [{ id: 'work', to: 'shift' }],
    },
    {
      id: 'shift',
      titleKey: 'stage.q2_first_pay.shift',
      hintKey: 'hint.q2_first_pay.shift',
      objectives: [
        {
          id: 'shift',
          kind: 'work_shift',
          labelKey: 'obj.q2_first_pay.shift',
          taskId: 'job_grocery_shift',
        },
      ],
      checkpoint: true,
      rewards: [{ id: 'first_wage', money: 25 }],
      onEnter: [{ kind: 'reel', event: 'job', textKey: 'reel.q2.firstjob' }],
      branches: [{ id: 'paid', to: 'spend' }],
    },
    {
      id: 'spend',
      titleKey: 'stage.q2_first_pay.spend',
      hintKey: 'hint.q2_first_pay.spend',
      objectives: [
        { id: 'buy', kind: 'buy', labelKey: 'obj.q2_first_pay.buy', serviceOffer: 'buy_meal' },
        {
          id: 'save',
          kind: 'buy',
          labelKey: 'obj.q2_first_pay.save',
          serviceOffer: 'buy_soap',
          optional: true,
        },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q2_first_pay.done',
          consequences: [
            { kind: 'flag', id: 'ch2_earned' },
            { kind: 'reputation', axis: 'community', delta: 0.06 },
            { kind: 'relationship', npcId: 'v_maryam', axes: { trust: 0.15, respect: 0.1 } },
          ],
        },
      ],
    },
  ],
};

/** The inventory and route mission, and the first rival. */
const DELIVERIES: QuestDef = {
  id: 'q2_deliveries',
  titleKey: 'quest.q2_deliveries.title',
  summaryKey: 'quest.q2_deliveries.summary',
  kind: 'main',
  chapter: 2,
  mode: 'story',
  minAge: 16,
  requires: ['q2_first_pay'],
  startStage: 'meet',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'meet',
      titleKey: 'stage.q2_deliveries.meet',
      hintKey: 'hint.q2_deliveries.meet',
      dialogueId: 'dlg_liya_round',
      objectives: [
        { id: 'liya', kind: 'talk', labelKey: 'obj.q2_deliveries.liya', npcId: 'v_liya' },
      ],
      checkpoint: true,
      branches: [{ id: 'run', to: 'round' }],
    },
    {
      id: 'round',
      titleKey: 'stage.q2_deliveries.round',
      hintKey: 'hint.q2_deliveries.round',
      objectives: [
        {
          id: 'round',
          kind: 'work_shift',
          labelKey: 'obj.q2_deliveries.round',
          taskId: 'job_parcel_delivery',
        },
      ],
      checkpoint: true,
      rewards: [{ id: 'round_pay', money: 18 }],
      branches: [
        {
          id: 'beat',
          to: null,
          outcomeKey: 'outcome.q2_deliveries.beat',
          requires: { minRelationship: { npcId: 'v_liya', axes: { respect: 0.2 } } },
          consequences: [
            { kind: 'flag', id: 'ch2_round_done' },
            { kind: 'relationship', npcId: 'v_liya', axes: { respect: 0.2, familiarity: 0.15 } },
            { kind: 'reputation', axis: 'community', delta: 0.05 },
          ],
        },
        {
          id: 'done',
          to: null,
          outcomeKey: 'outcome.q2_deliveries.done',
          consequences: [
            { kind: 'flag', id: 'ch2_round_done' },
            { kind: 'relationship', npcId: 'v_liya', axes: { familiarity: 0.12 } },
          ],
        },
      ],
    },
  ],
};

/**
 * The first vehicle, and the first branch that sticks.
 *
 * Earn it, or fix it. The two routes cost different things — money against
 * time and a favour — and both end with a bicycle, because a chapter that can
 * leave the player without one breaks chapter 3.
 */
const THE_BICYCLE: QuestDef = {
  id: 'q2_the_bicycle',
  titleKey: 'quest.q2_the_bicycle.title',
  summaryKey: 'quest.q2_the_bicycle.summary',
  kind: 'main',
  chapter: 2,
  mode: 'story',
  minAge: 16,
  requires: ['q2_deliveries'],
  startStage: 'choose',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'choose',
      titleKey: 'stage.q2_the_bicycle.choose',
      hintKey: 'hint.q2_the_bicycle.choose',
      dialogueId: 'dlg_tomas_bicycle',
      objectives: [
        { id: 'tomas', kind: 'talk', labelKey: 'obj.q2_the_bicycle.tomas', npcId: 'v_tomas' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'buy',
          to: 'buy',
          requires: { choice: { id: 'ch2_bicycle', is: 'buy' } },
        },
        { id: 'fix', to: 'fix' },
      ],
    },
    {
      id: 'buy',
      titleKey: 'stage.q2_the_bicycle.buy',
      hintKey: 'hint.q2_the_bicycle.buy',
      objectives: [
        { id: 'pay', kind: 'buy', labelKey: 'obj.q2_the_bicycle.pay', serviceOffer: 'buy_bicycle' },
      ],
      checkpoint: true,
      branches: [{ id: 'ride', to: 'ride' }],
    },
    {
      id: 'fix',
      titleKey: 'stage.q2_the_bicycle.fix',
      hintKey: 'hint.q2_the_bicycle.fix',
      objectives: [
        {
          id: 'parts',
          kind: 'collect',
          labelKey: 'obj.q2_the_bicycle.parts',
          itemId: 'repair_kit',
          count: 1,
        },
        {
          id: 'bench',
          kind: 'interact',
          labelKey: 'obj.q2_the_bicycle.bench',
          place: 'garage_lift',
          count: 2,
        },
      ],
      checkpoint: true,
      rewards: [{ id: 'keys', items: [{ id: 'keys_bicycle', count: 1 }] }],
      branches: [
        {
          id: 'ride',
          to: 'ride',
          consequences: [
            { kind: 'relationship', npcId: 'v_tomas', axes: { trust: 0.2, respect: 0.15 } },
          ],
        },
      ],
    },
    {
      id: 'ride',
      titleKey: 'stage.q2_the_bicycle.ride',
      hintKey: 'hint.q2_the_bicycle.ride',
      objectives: [
        {
          id: 'lap',
          kind: 'drive',
          labelKey: 'obj.q2_the_bicycle.lap',
          vehicleKind: 'bicycle',
          metres: 900,
        },
      ],
      onEnter: [{ kind: 'reel', event: 'vehicle', textKey: 'reel.q2.bicycle' }],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q2_the_bicycle.done',
          consequences: [
            { kind: 'flag', id: 'ch2_has_bicycle' },
            { kind: 'completeChapter', id: 'chapter_2' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.2' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 3 — Age 17: "The Road Test"
// ---------------------------------------------------------------------------

/** The driving mission. `drive` then `park` — the two halves of the system. */
const ROAD_TEST: QuestDef = {
  id: 'q3_road_test',
  titleKey: 'quest.q3_road_test.title',
  summaryKey: 'quest.q3_road_test.summary',
  kind: 'main',
  chapter: 3,
  mode: 'story',
  minAge: 17,
  requires: ['q2_the_bicycle'],
  startStage: 'lesson',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'lesson',
      titleKey: 'stage.q3_road_test.lesson',
      hintKey: 'hint.q3_road_test.lesson',
      dialogueId: 'dlg_tomas_lesson',
      objectives: [
        { id: 'ask', kind: 'talk', labelKey: 'obj.q3_road_test.ask', npcId: 'v_tomas' },
      ],
      checkpoint: true,
      branches: [{ id: 'drive', to: 'drive' }],
    },
    {
      id: 'drive',
      titleKey: 'stage.q3_road_test.drive',
      hintKey: 'hint.q3_road_test.drive',
      objectives: [
        {
          id: 'distance',
          kind: 'drive',
          labelKey: 'obj.q3_road_test.distance',
          vehicleKind: 'hatchback',
          metres: 1200,
        },
        {
          id: 'clean',
          kind: 'interact',
          labelKey: 'obj.q3_road_test.clean',
          place: 'village_junction',
          optional: true,
        },
      ],
      checkpoint: true,
      branches: [{ id: 'park', to: 'park' }],
    },
    {
      id: 'park',
      titleKey: 'stage.q3_road_test.park',
      hintKey: 'hint.q3_road_test.park',
      objectives: [
        { id: 'bay', kind: 'park', labelKey: 'obj.q3_road_test.bay', place: 'village_parking' },
      ],
      rewards: [{ id: 'licence', items: [{ id: 'licence', count: 1 }] }],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q3_road_test.done',
          consequences: [
            { kind: 'flag', id: 'ch3_licence' },
            { kind: 'reel', event: 'vehicle', textKey: 'reel.q3.licence' },
            { kind: 'reputation', axis: 'community', delta: 0.04 },
          ],
        },
      ],
    },
  ],
};

/**
 * The mentor fork, and the first choice the endings actually read.
 *
 * Trade with Tomás, school with Eleni, or the road with Liya. Nothing is
 * closed off by it — each shifts which side tasks are offered and which
 * chapter-6 route is cheapest, which is the level of consequence a single
 * conversation can honestly carry.
 */
const MENTOR: QuestDef = {
  id: 'q3_mentor',
  titleKey: 'quest.q3_mentor.title',
  summaryKey: 'quest.q3_mentor.summary',
  kind: 'main',
  chapter: 3,
  mode: 'story',
  minAge: 17,
  requires: ['q3_road_test'],
  startStage: 'weigh',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'weigh',
      titleKey: 'stage.q3_mentor.weigh',
      hintKey: 'hint.q3_mentor.weigh',
      dialogueId: 'dlg_mentor_choice',
      objectives: [
        {
          id: 'trade',
          kind: 'talk',
          labelKey: 'obj.q3_mentor.trade',
          npcId: 'v_tomas',
          optional: true,
        },
        {
          id: 'school',
          kind: 'talk',
          labelKey: 'obj.q3_mentor.school',
          npcId: 'v_eleni',
          optional: true,
        },
        { id: 'decide', kind: 'interact', labelKey: 'obj.q3_mentor.decide', place: 'village_hall' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'trade',
          to: null,
          outcomeKey: 'outcome.q3_mentor.trade',
          requires: { choice: { id: 'ch3_mentor', is: 'trade' } },
          consequences: [
            { kind: 'flag', id: 'ch3_mentor_trade' },
            { kind: 'relationship', npcId: 'v_tomas', axes: { trust: 0.25, respect: 0.2 } },
          ],
        },
        {
          id: 'school',
          to: null,
          outcomeKey: 'outcome.q3_mentor.school',
          requires: { choice: { id: 'ch3_mentor', is: 'school' } },
          consequences: [
            { kind: 'flag', id: 'ch3_mentor_school' },
            { kind: 'relationship', npcId: 'v_eleni', axes: { trust: 0.25, respect: 0.2 } },
          ],
        },
        {
          id: 'road',
          to: null,
          outcomeKey: 'outcome.q3_mentor.road',
          consequences: [
            { kind: 'flag', id: 'ch3_mentor_road' },
            { kind: 'choice', id: 'ch3_mentor', value: 'road' },
            { kind: 'relationship', npcId: 'v_liya', axes: { familiarity: 0.2, respect: 0.15 } },
          ],
        },
      ],
    },
  ],
};

/**
 * The village problem, planted here and paid off in chapter 6.
 *
 * Bashir's field is on the only flat land near the road. Somebody in the city
 * wants it. Chapter 3 only lets the player *see* that — the offer does not
 * exist yet — which is what makes chapter 6 land rather than arrive.
 */
const THE_CRACK: QuestDef = {
  id: 'q3_the_crack',
  titleKey: 'quest.q3_the_crack.title',
  summaryKey: 'quest.q3_the_crack.summary',
  kind: 'main',
  chapter: 3,
  mode: 'story',
  minAge: 17,
  requires: ['q3_mentor'],
  startStage: 'notice',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'notice',
      titleKey: 'stage.q3_the_crack.notice',
      hintKey: 'hint.q3_the_crack.notice',
      objectives: [
        { id: 'field', kind: 'travel', labelKey: 'obj.q3_the_crack.field', place: 'village_field' },
        { id: 'bashir', kind: 'talk', labelKey: 'obj.q3_the_crack.bashir', npcId: 'v_bashir' },
      ],
      checkpoint: true,
      dialogueId: 'dlg_bashir_field',
      branches: [{ id: 'ask', to: 'ask' }],
    },
    {
      id: 'ask',
      titleKey: 'stage.q3_the_crack.ask',
      hintKey: 'hint.q3_the_crack.ask',
      sceneId: 'cs_the_survey_peg',
      objectives: [
        { id: 'hamid', kind: 'talk', labelKey: 'obj.q3_the_crack.hamid', npcId: 'v_hamid' },
        {
          id: 'peg',
          kind: 'interact',
          labelKey: 'obj.q3_the_crack.peg',
          place: 'village_field',
        },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q3_the_crack.done',
          consequences: [
            { kind: 'flag', id: 'ch3_saw_the_peg' },
            { kind: 'reel', event: 'choice', textKey: 'reel.q3.peg' },
            { kind: 'completeChapter', id: 'chapter_3' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.3' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 4 — Age 18: "City Lights"
// ---------------------------------------------------------------------------

/**
 * Leaving.
 *
 * The one quest that completes `village_departure`, which is the chapter id
 * `Gates.cityAccess` has been checking since Phase 3. Everything about the
 * city is already gated on it; this is what finally sets it.
 */
const DEPARTURE: QuestDef = {
  id: 'q4_departure',
  titleKey: 'quest.q4_departure.title',
  summaryKey: 'quest.q4_departure.summary',
  kind: 'main',
  chapter: 4,
  mode: 'story',
  minAge: 18,
  requires: ['q3_the_crack'],
  startStage: 'goodbyes',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'goodbyes',
      titleKey: 'stage.q4_departure.goodbyes',
      hintKey: 'hint.q4_departure.goodbyes',
      dialogueId: 'dlg_leaving',
      objectives: [
        { id: 'home', kind: 'talk', labelKey: 'obj.q4_departure.home', npcId: 'v_eleni' },
        {
          id: 'friend',
          kind: 'talk',
          labelKey: 'obj.q4_departure.friend',
          npcId: 'v_noor',
          optional: true,
        },
        {
          id: 'elder',
          kind: 'talk',
          labelKey: 'obj.q4_departure.elder',
          npcId: 'v_hamid',
          optional: true,
        },
      ],
      checkpoint: true,
      branches: [{ id: 'pack', to: 'pack' }],
    },
    {
      id: 'pack',
      titleKey: 'stage.q4_departure.pack',
      hintKey: 'hint.q4_departure.pack',
      sceneId: 'cs_leaving_the_village',
      objectives: [
        { id: 'sleep', kind: 'interact', labelKey: 'obj.q4_departure.sleep', place: 'home_bed' },
      ],
      checkpoint: true,
      onEnter: [
        { kind: 'completeChapter', id: 'village_departure' },
        { kind: 'unlockZone', zone: 'city_old_market' },
      ],
      branches: [{ id: 'go', to: 'arrive' }],
    },
    {
      id: 'arrive',
      titleKey: 'stage.q4_departure.arrive',
      hintKey: 'hint.q4_departure.arrive',
      objectives: [
        {
          id: 'city',
          kind: 'travel',
          labelKey: 'obj.q4_departure.city',
          zone: 'city_old_market',
        },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q4_departure.done',
          consequences: [
            { kind: 'flag', id: 'ch4_in_city' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.q4.arrived' },
          ],
        },
      ],
    },
  ],
};

/** The property mission: a door of your own, and the rent that comes with it. */
const FIRST_KEY: QuestDef = {
  id: 'q4_first_key',
  titleKey: 'quest.q4_first_key.title',
  summaryKey: 'quest.q4_first_key.summary',
  kind: 'main',
  chapter: 4,
  mode: 'story',
  minAge: 18,
  requires: ['q4_departure'],
  startStage: 'find',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'find',
      titleKey: 'stage.q4_first_key.find',
      hintKey: 'hint.q4_first_key.find',
      dialogueId: 'dlg_dawit_lease',
      objectives: [
        { id: 'clerk', kind: 'talk', labelKey: 'obj.q4_first_key.clerk', npcId: 'c_dawit' },
      ],
      checkpoint: true,
      branches: [{ id: 'sign', to: 'sign' }],
    },
    {
      id: 'sign',
      titleKey: 'stage.q4_first_key.sign',
      hintKey: 'hint.q4_first_key.sign',
      // Point ids are the interior catalogue's, not invented ones: `apt_bed`,
      // not `apartment_bed`. The validator caught four of those the first time
      // it checked place names, and each would have been an objective that
      // could never complete — nothing would ever report a name nothing has.
      //
      // There is no separate "get to the apartment" objective. Sleeping there
      // requires getting there, and an objective that another objective
      // implies is a line on the HUD doing no work.
      objectives: [
        {
          id: 'sleep',
          kind: 'interact',
          labelKey: 'obj.q4_first_key.sleep',
          place: 'apt_bed',
        },
        {
          id: 'decorate',
          kind: 'interact',
          labelKey: 'obj.q4_first_key.decorate',
          place: 'apt_decorate',
          optional: true,
        },
      ],
      onEnter: [{ kind: 'reel', event: 'property', textKey: 'reel.q4.apartment' }],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q4_first_key.done',
          consequences: [{ kind: 'flag', id: 'ch4_has_apartment' }],
        },
      ],
    },
  ],
};

/** The city-services mission: a job, a bank of jobs, and the police desk. */
const CITY_JOB: QuestDef = {
  id: 'q4_city_job',
  titleKey: 'quest.q4_city_job.title',
  summaryKey: 'quest.q4_city_job.summary',
  kind: 'main',
  chapter: 4,
  mode: 'story',
  minAge: 18,
  requires: ['q4_first_key'],
  startStage: 'hunt',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'hunt',
      titleKey: 'stage.q4_city_job.hunt',
      hintKey: 'hint.q4_city_job.hunt',
      dialogueId: 'dlg_yusuf_hire',
      objectives: [
        { id: 'yusuf', kind: 'talk', labelKey: 'obj.q4_city_job.yusuf', npcId: 'c_yusuf' },
        {
          id: 'priya',
          kind: 'talk',
          labelKey: 'obj.q4_city_job.priya',
          npcId: 'c_priya',
          optional: true,
        },
      ],
      checkpoint: true,
      branches: [{ id: 'work', to: 'work' }],
    },
    {
      id: 'work',
      titleKey: 'stage.q4_city_job.work',
      hintKey: 'hint.q4_city_job.work',
      objectives: [
        {
          id: 'courier',
          kind: 'work_shift',
          labelKey: 'obj.q4_city_job.courier',
          taskId: 'job_city_courier',
        },
      ],
      checkpoint: true,
      rewards: [{ id: 'city_wage', money: 40 }],
      branches: [{ id: 'settle', to: 'settle' }],
    },
    {
      id: 'settle',
      titleKey: 'stage.q4_city_job.settle',
      hintKey: 'hint.q4_city_job.settle',
      objectives: [
        { id: 'desk', kind: 'travel', labelKey: 'obj.q4_city_job.desk', place: 'police_desk' },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q4_city_job.done',
          consequences: [
            { kind: 'flag', id: 'ch4_working' },
            { kind: 'reel', event: 'job', textKey: 'reel.q4.job' },
            { kind: 'completeChapter', id: 'chapter_4' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.4' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 5 — Ages 19-21: "A Name of Your Own"
// ---------------------------------------------------------------------------

/**
 * Money, skill and standing — by whichever road.
 *
 * Three routes to the same stage, and the difference is what they cost. The
 * straight one asks for shifts. The fast one asks for a favour from Omar and
 * takes `law` down. The mixed one does some of each. All three arrive; the
 * ending resolver is where they diverge for good.
 */
const A_NAME: QuestDef = {
  id: 'q5_a_name',
  titleKey: 'quest.q5_a_name.title',
  summaryKey: 'quest.q5_a_name.summary',
  kind: 'main',
  chapter: 5,
  mode: 'story',
  minAge: 19,
  requires: ['q4_city_job'],
  startStage: 'choose',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'choose',
      titleKey: 'stage.q5_a_name.choose',
      hintKey: 'hint.q5_a_name.choose',
      dialogueId: 'dlg_omar_shortcut',
      objectives: [
        { id: 'omar', kind: 'talk', labelKey: 'obj.q5_a_name.omar', npcId: 'c_omar' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'shortcut',
          to: 'shortcut',
          requires: { choice: { id: 'ch5_route', is: 'shortcut' } },
        },
        { id: 'straight', to: 'straight' },
      ],
    },
    {
      id: 'straight',
      titleKey: 'stage.q5_a_name.straight',
      hintKey: 'hint.q5_a_name.straight',
      objectives: [
        {
          id: 'shifts',
          kind: 'work_shift',
          labelKey: 'obj.q5_a_name.shifts',
          taskId: 'job_garage_recovery',
          count: 2,
        },
        { id: 'saved', kind: 'buy', labelKey: 'obj.q5_a_name.saved', serviceOffer: 'buy_scooter' },
      ],
      checkpoint: true,
      rewards: [{ id: 'standing', money: 60 }],
      branches: [
        {
          id: 'on',
          to: 'known',
          consequences: [
            { kind: 'reputation', axis: 'community', delta: 0.18 },
            { kind: 'choice', id: 'ch5_route', value: 'straight' },
            { kind: 'flag', id: 'ch5_legal' },
          ],
        },
      ],
    },
    {
      id: 'shortcut',
      titleKey: 'stage.q5_a_name.shortcut',
      hintKey: 'hint.q5_a_name.shortcut',
      objectives: [
        {
          id: 'run',
          kind: 'deliver',
          labelKey: 'obj.q5_a_name.run',
          place: 'city_drop_c',
          itemId: 'parcel',
          count: 2,
        },
        { id: 'quiet', kind: 'interact', labelKey: 'obj.q5_a_name.quiet', place: 'wf_dock' },
      ],
      checkpoint: true,
      rewards: [{ id: 'fast_money', money: 220 }],
      fail: { timeLimit: null, onFail: 'checkpoint', messageKey: 'fail.q5_a_name.caught' },
      branches: [
        {
          id: 'on',
          to: 'known',
          consequences: [
            { kind: 'reputation', axis: 'law', delta: -0.3 },
            { kind: 'reputation', axis: 'community', delta: 0.04 },
            { kind: 'flag', id: 'ch5_shortcut' },
            { kind: 'reel', event: 'law', textKey: 'reel.q5.shortcut' },
          ],
        },
      ],
    },
    {
      id: 'known',
      titleKey: 'stage.q5_a_name.known',
      hintKey: 'hint.q5_a_name.known',
      sceneId: 'cs_a_name_of_your_own',
      objectives: [
        { id: 'cafe', kind: 'talk', labelKey: 'obj.q5_a_name.cafe', npcId: 'c_sana' },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q5_a_name.done',
          consequences: [{ kind: 'flag', id: 'ch5_known' }],
        },
      ],
    },
  ],
};

/** The relationship mission. Whoever it is, it is chosen rather than assigned. */
const SOMEONE: QuestDef = {
  id: 'q5_someone',
  titleKey: 'quest.q5_someone.title',
  summaryKey: 'quest.q5_someone.summary',
  kind: 'main',
  chapter: 5,
  mode: 'story',
  minAge: 20,
  requires: ['q5_a_name'],
  startStage: 'evenings',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'evenings',
      titleKey: 'stage.q5_someone.evenings',
      hintKey: 'hint.q5_someone.evenings',
      dialogueId: 'dlg_someone',
      objectives: [
        { id: 'sana', kind: 'talk', labelKey: 'obj.q5_someone.sana', npcId: 'c_sana', optional: true },
        { id: 'hana', kind: 'talk', labelKey: 'obj.q5_someone.hana', npcId: 'c_hana', optional: true },
        { id: 'noor', kind: 'talk', labelKey: 'obj.q5_someone.noor', npcId: 'v_noor', optional: true },
        { id: 'meal', kind: 'buy', labelKey: 'obj.q5_someone.meal', serviceOffer: 'buy_meal' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'sana',
          to: null,
          outcomeKey: 'outcome.q5_someone.sana',
          requires: { choice: { id: 'ch5_someone', is: 'sana' } },
          consequences: [
            { kind: 'flag', id: 'ch5_partner_sana' },
            { kind: 'relationship', npcId: 'c_sana', axes: { affection: 0.35, trust: 0.25 } },
            { kind: 'reel', event: 'relationship', textKey: 'reel.q5.sana' },
          ],
        },
        {
          id: 'hana',
          to: null,
          outcomeKey: 'outcome.q5_someone.hana',
          requires: { choice: { id: 'ch5_someone', is: 'hana' } },
          consequences: [
            { kind: 'flag', id: 'ch5_partner_hana' },
            { kind: 'relationship', npcId: 'c_hana', axes: { affection: 0.35, trust: 0.25 } },
            { kind: 'reel', event: 'relationship', textKey: 'reel.q5.hana' },
          ],
        },
        {
          id: 'noor',
          to: null,
          outcomeKey: 'outcome.q5_someone.noor',
          requires: { choice: { id: 'ch5_someone', is: 'noor' } },
          consequences: [
            { kind: 'flag', id: 'ch5_partner_noor' },
            { kind: 'relationship', npcId: 'v_noor', axes: { affection: 0.35, trust: 0.3 } },
            { kind: 'reel', event: 'relationship', textKey: 'reel.q5.noor' },
          ],
        },
        {
          id: 'alone',
          to: null,
          outcomeKey: 'outcome.q5_someone.alone',
          consequences: [
            { kind: 'flag', id: 'ch5_alone' },
            { kind: 'choice', id: 'ch5_someone', value: 'alone' },
            { kind: 'completeChapter', id: 'chapter_5' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.5' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 6 — Ages 22-24: "What the Road Costs"
// ---------------------------------------------------------------------------

/**
 * The offer on Bashir's field, and five ways to answer it.
 *
 * This is the chapter the whole story is built toward, and the one place every
 * axis is read at once: money, `law`, `community`, and a relationship with a
 * farmer the player met at seventeen.
 *
 * **Four of the five routes are legal.** `crime` is one option among five and
 * it is never the cheapest — the brief requires that the story never *demand*
 * violent crime, and the honest way to satisfy that is to make the lawful
 * routes fully competitive rather than to add a token alternative.
 */
const THE_OFFER: QuestDef = {
  id: 'q6_the_offer',
  titleKey: 'quest.q6_the_offer.title',
  summaryKey: 'quest.q6_the_offer.summary',
  kind: 'main',
  chapter: 6,
  mode: 'story',
  minAge: 22,
  requires: ['q5_someone'],
  startStage: 'letter',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'letter',
      titleKey: 'stage.q6_the_offer.letter',
      hintKey: 'hint.q6_the_offer.letter',
      sceneId: 'cs_the_letter',
      objectives: [
        { id: 'read', kind: 'interact', labelKey: 'obj.q6_the_offer.read', place: 'apt_desk' },
        { id: 'home', kind: 'travel', labelKey: 'obj.q6_the_offer.home', zone: 'village_coast' },
      ],
      checkpoint: true,
      branches: [{ id: 'see', to: 'weigh' }],
    },
    {
      id: 'weigh',
      titleKey: 'stage.q6_the_offer.weigh',
      hintKey: 'hint.q6_the_offer.weigh',
      dialogueId: 'dlg_the_offer',
      objectives: [
        { id: 'bashir', kind: 'talk', labelKey: 'obj.q6_the_offer.bashir', npcId: 'v_bashir' },
        {
          id: 'george',
          kind: 'talk',
          labelKey: 'obj.q6_the_offer.george',
          npcId: 'c_george',
          optional: true,
        },
        {
          id: 'rosa',
          kind: 'talk',
          labelKey: 'obj.q6_the_offer.rosa',
          npcId: 'c_rosa',
          optional: true,
        },
      ],
      checkpoint: true,
      branches: [
        { id: 'protect', to: 'protect', requires: { choice: { id: 'ch6_route', is: 'protect' } } },
        { id: 'exploit', to: 'exploit', requires: { choice: { id: 'ch6_route', is: 'exploit' } } },
        { id: 'expose', to: 'expose', requires: { choice: { id: 'ch6_route', is: 'expose' } } },
        { id: 'law', to: 'law', requires: { choice: { id: 'ch6_route', is: 'law' } } },
        { id: 'crime', to: 'crime', requires: { choice: { id: 'ch6_route', is: 'crime' } } },
        { id: 'undecided', to: 'protect' },
      ],
    },
    {
      id: 'protect',
      titleKey: 'stage.q6_the_offer.protect',
      hintKey: 'hint.q6_the_offer.protect',
      objectives: [
        { id: 'petition', kind: 'interact', labelKey: 'obj.q6_the_offer.petition', place: 'village_hall', count: 3 },
        { id: 'fund', kind: 'buy', labelKey: 'obj.q6_the_offer.fund', serviceOffer: 'donate_fund' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'end',
          to: 'settled',
          consequences: [
            { kind: 'flag', id: 'ch6_protected' },
            { kind: 'reputation', axis: 'community', delta: 0.3 },
            { kind: 'relationship', npcId: 'v_bashir', axes: { trust: 0.4, respect: 0.3 } },
            { kind: 'reel', event: 'choice', textKey: 'reel.q6.protect' },
          ],
        },
      ],
    },
    {
      id: 'exploit',
      titleKey: 'stage.q6_the_offer.exploit',
      hintKey: 'hint.q6_the_offer.exploit',
      objectives: [
        { id: 'broker', kind: 'talk', labelKey: 'obj.q6_the_offer.broker', npcId: 'c_dawit' },
        { id: 'sign', kind: 'interact', labelKey: 'obj.q6_the_offer.sign', place: 'om_office' },
      ],
      checkpoint: true,
      rewards: [{ id: 'commission', money: 900 }],
      branches: [
        {
          id: 'end',
          to: 'settled',
          consequences: [
            { kind: 'flag', id: 'ch6_exploited' },
            { kind: 'reputation', axis: 'community', delta: -0.35 },
            { kind: 'relationship', npcId: 'v_bashir', axes: { trust: -0.5, respect: -0.3 } },
            { kind: 'reel', event: 'choice', textKey: 'reel.q6.exploit' },
          ],
        },
      ],
    },
    {
      id: 'expose',
      titleKey: 'stage.q6_the_offer.expose',
      hintKey: 'hint.q6_the_offer.expose',
      objectives: [
        { id: 'papers', kind: 'collect', labelKey: 'obj.q6_the_offer.papers', itemId: 'documents', count: 3 },
        { id: 'witness', kind: 'talk', labelKey: 'obj.q6_the_offer.witness', npcId: 'c_george' },
        { id: 'print', kind: 'interact', labelKey: 'obj.q6_the_offer.print', place: 'om_office' },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'end',
          to: 'settled',
          consequences: [
            { kind: 'flag', id: 'ch6_exposed' },
            { kind: 'reputation', axis: 'community', delta: 0.25 },
            { kind: 'reputation', axis: 'law', delta: 0.1 },
            { kind: 'reel', event: 'choice', textKey: 'reel.q6.expose' },
          ],
        },
      ],
    },
    {
      id: 'law',
      titleKey: 'stage.q6_the_offer.law',
      hintKey: 'hint.q6_the_offer.law',
      objectives: [
        { id: 'amina', kind: 'talk', labelKey: 'obj.q6_the_offer.amina', npcId: 'c_amina' },
        { id: 'file', kind: 'interact', labelKey: 'obj.q6_the_offer.file', place: 'police_desk', count: 2 },
        { id: 'wait', kind: 'wait', labelKey: 'obj.q6_the_offer.wait', seconds: 40 },
      ],
      checkpoint: true,
      branches: [
        {
          id: 'end',
          to: 'settled',
          consequences: [
            { kind: 'flag', id: 'ch6_lawful' },
            { kind: 'reputation', axis: 'law', delta: 0.2 },
            { kind: 'reputation', axis: 'community', delta: 0.15 },
            { kind: 'relationship', npcId: 'c_amina', axes: { trust: 0.35, respect: 0.25 } },
            { kind: 'reel', event: 'choice', textKey: 'reel.q6.law' },
          ],
        },
      ],
    },
    {
      /**
       * The crooked route.
       *
       * Note what it is *not*: there is no `combat` objective here, and no
       * stage on any main quest has one. Taking the survey pegs out of a field
       * at night is trespass and theft, which the Phase 9 Heat system will
       * price properly. It is never required, and it is the only one of the
       * five that can fail into a police station.
       */
      id: 'crime',
      titleKey: 'stage.q6_the_offer.crime',
      hintKey: 'hint.q6_the_offer.crime',
      objectives: [
        { id: 'night', kind: 'travel', labelKey: 'obj.q6_the_offer.night', place: 'village_field' },
        { id: 'pegs', kind: 'interact', labelKey: 'obj.q6_the_offer.pegs', place: 'village_field', count: 3 },
        // 70 m, not the 120 the first draft asked for. The village measures
        // roughly 120 m corner to corner — the far house to the shore bench is
        // 119 — so an escape of 120 m from a field in the middle of it is
        // geometrically impossible. Found by a browser test that measured 81 m
        // across the longest run available and could not finish.
        // No `seconds` here: an escape's target is its distance, and the time
        // limit is the *stage's* — `fail.timeLimit` below. Carrying both would
        // be two numbers claiming to be the deadline, and only one of them
        // would be read.
        { id: 'away', kind: 'escape', labelKey: 'obj.q6_the_offer.away', metres: 70 },
      ],
      checkpoint: true,
      fail: { timeLimit: 180, onFail: 'checkpoint', messageKey: 'fail.q6_the_offer.seen' },
      branches: [
        {
          id: 'end',
          to: 'settled',
          consequences: [
            { kind: 'flag', id: 'ch6_crime' },
            { kind: 'reputation', axis: 'law', delta: -0.45 },
            { kind: 'reputation', axis: 'community', delta: 0.1 },
            { kind: 'reel', event: 'law', textKey: 'reel.q6.crime' },
          ],
        },
      ],
    },
    {
      id: 'settled',
      titleKey: 'stage.q6_the_offer.settled',
      hintKey: 'hint.q6_the_offer.settled',
      sceneId: 'cs_what_the_road_costs',
      objectives: [
        { id: 'back', kind: 'talk', labelKey: 'obj.q6_the_offer.back', npcId: 'v_bashir' },
      ],
      branches: [
        {
          id: 'end',
          to: null,
          outcomeKey: 'outcome.q6_the_offer.done',
          consequences: [
            { kind: 'completeChapter', id: 'chapter_6' },
            { kind: 'reel', event: 'chapter', textKey: 'reel.chapter.6' },
          ],
        },
      ],
    },
  ],
};

// ---------------------------------------------------------------------------
// Chapter 7 — Age 25: "The Last Horizon"
// ---------------------------------------------------------------------------

/**
 * The last one.
 *
 * The quest itself is short on purpose: by twenty-five every input the ending
 * reads has already happened, and a long final mission would only be a chance
 * to change an answer the player already gave. What it does is *ask* — where
 * do you live now — and then hand the accumulated state to `resolveEnding`.
 */
const LAST_HORIZON: QuestDef = {
  id: 'q7_last_horizon',
  titleKey: 'quest.q7_last_horizon.title',
  summaryKey: 'quest.q7_last_horizon.summary',
  kind: 'main',
  chapter: 7,
  mode: 'story',
  minAge: 25,
  requires: ['q6_the_offer'],
  startStage: 'accounts',
  abandonable: false,
  contentVersion: 1,
  stages: [
    {
      id: 'accounts',
      titleKey: 'stage.q7_last_horizon.accounts',
      hintKey: 'hint.q7_last_horizon.accounts',
      dialogueId: 'dlg_last_horizon',
      objectives: [
        { id: 'letter', kind: 'talk', labelKey: 'obj.q7_last_horizon.letter', npcId: 'v_eleni' },
        {
          id: 'partner',
          kind: 'interact',
          labelKey: 'obj.q7_last_horizon.partner',
          place: 'cafe_seat_a',
          optional: true,
        },
      ],
      checkpoint: true,
      branches: [{ id: 'decide', to: 'decide' }],
    },
    {
      id: 'decide',
      titleKey: 'stage.q7_last_horizon.decide',
      hintKey: 'hint.q7_last_horizon.decide',
      sceneId: 'cs_the_last_horizon',
      objectives: [
        { id: 'stand', kind: 'travel', labelKey: 'obj.q7_last_horizon.stand', place: 'village_hill' },
      ],
      branches: [
        {
          id: 'return',
          to: null,
          outcomeKey: 'outcome.q7.return',
          requires: { choice: { id: 'ch7_home', is: 'return' } },
          consequences: [{ kind: 'flag', id: 'ch7_return' }],
        },
        {
          id: 'stay',
          to: null,
          outcomeKey: 'outcome.q7.stay',
          requires: { choice: { id: 'ch7_home', is: 'stay' } },
          consequences: [{ kind: 'flag', id: 'ch7_stay' }],
        },
        {
          id: 'between',
          to: null,
          outcomeKey: 'outcome.q7.between',
          consequences: [
            { kind: 'flag', id: 'ch7_between' },
            { kind: 'choice', id: 'ch7_home', value: 'between' },
          ],
        },
      ],
    },
  ],
};

export const MAIN_QUESTS: readonly QuestDef[] = [
  KEEPSAKES,
  THE_ROAD,
  FIRST_PAY,
  DELIVERIES,
  THE_BICYCLE,
  ROAD_TEST,
  MENTOR,
  THE_CRACK,
  DEPARTURE,
  FIRST_KEY,
  CITY_JOB,
  A_NAME,
  SOMEONE,
  THE_OFFER,
  LAST_HORIZON,
];
