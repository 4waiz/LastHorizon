import type { Consequence, QuestDef, QuestObjective, QuestReward } from './QuestDefinition';

/**
 * Twenty side tasks, one shape.
 *
 * Every one of these is "somebody in the world wants a specific thing done",
 * and structurally they are all the same quest: one stage, some objectives, a
 * payment, a consequence, done. Writing twenty of those out longhand is twenty
 * chances to leave a branch off and strand the player on a finished stage — so
 * there is one builder and twenty rows of data.
 *
 * Side tasks are **abandonable**, unlike every main chapter. Putting one down
 * has to be free, because the alternative is a journal that fills with
 * favours a player no longer wants and cannot clear.
 *
 * They are also **not** repeatable. A repeatable errand is a *job*, and jobs
 * live in `src/tasks/` with difficulty scaling and a per-run award key. The
 * side tasks here are one-offs that happen to be small.
 */

interface SideSpec {
  readonly id: string;
  readonly chapter: number;
  readonly minAge?: number;
  readonly requires?: readonly string[];
  readonly objectives: readonly QuestObjective[];
  readonly money?: number;
  readonly items?: QuestReward['items'];
  readonly consequences?: readonly Consequence[];
  /** A cutscene for the two that earn one. Most do not. */
  readonly sceneId?: string;
}

/**
 * Keys are derived, never written out.
 *
 * A side task's title, summary, stage and hint keys are all `<id>`-shaped, so
 * a typo cannot silently point at another task's string — and the validator
 * checks every derived key exists, which is what catches a task added to this
 * list but not to `strings.ts`.
 */
function side(spec: SideSpec): QuestDef {
  const rewards: QuestReward[] =
    spec.money !== undefined || spec.items !== undefined
      ? [{ id: 'pay', money: spec.money, items: spec.items }]
      : [];

  return {
    id: spec.id,
    titleKey: `quest.${spec.id}.title`,
    summaryKey: `quest.${spec.id}.summary`,
    kind: 'side',
    chapter: spec.chapter,
    minAge: spec.minAge,
    requires: spec.requires,
    startStage: 'do',
    abandonable: true,
    contentVersion: 1,
    stages: [
      {
        id: 'do',
        titleKey: `stage.${spec.id}.do`,
        hintKey: `hint.${spec.id}.do`,
        sceneId: spec.sceneId,
        objectives: spec.objectives,
        checkpoint: true,
        rewards,
        branches: [
          {
            id: 'end',
            to: null,
            outcomeKey: `outcome.${spec.id}.done`,
            consequences: spec.consequences,
          },
        ],
      },
    ],
  };
}

/** Small, warm, and worth a little standing. The village half. */
const VILLAGE: readonly QuestDef[] = [
  side({
    id: 's_neighbour_errand',
    chapter: 1,
    objectives: [
      { id: 'ask', kind: 'talk', labelKey: 'obj.s_neighbour_errand.ask', npcId: 'v_gita' },
      { id: 'buy', kind: 'buy', labelKey: 'obj.s_neighbour_errand.buy', itemId: 'apple' },
      {
        id: 'back',
        kind: 'deliver',
        labelKey: 'obj.s_neighbour_errand.back',
        place: 'village_home',
        itemId: 'apple',
      },
    ],
    money: 14,
    consequences: [
      { kind: 'relationship', npcId: 'v_gita', axes: { familiarity: 0.2, affection: 0.15 } },
      { kind: 'reputation', axis: 'community', delta: 0.03 },
    ],
  }),
  side({
    id: 's_village_history',
    chapter: 1,
    objectives: [
      { id: 'sit', kind: 'travel', labelKey: 'obj.s_village_history.sit', place: 'village_bench' },
      { id: 'listen', kind: 'talk', labelKey: 'obj.s_village_history.listen', npcId: 'v_hamid' },
      { id: 'stay', kind: 'wait', labelKey: 'obj.s_village_history.stay', seconds: 30 },
    ],
    consequences: [
      { kind: 'relationship', npcId: 'v_hamid', axes: { familiarity: 0.25, trust: 0.2 } },
      { kind: 'flag', id: 'knows_village_history' },
      { kind: 'reel', event: 'choice', textKey: 'reel.side.history' },
    ],
  }),
  side({
    id: 's_lost_camera',
    chapter: 1,
    objectives: [
      { id: 'noor', kind: 'talk', labelKey: 'obj.s_lost_camera.noor', npcId: 'v_noor' },
      { id: 'hunt', kind: 'travel', labelKey: 'obj.s_lost_camera.hunt', place: 'village_yard' },
      { id: 'find', kind: 'collect', labelKey: 'obj.s_lost_camera.find', itemId: 'old_camera' },
    ],
    money: 10,
    consequences: [
      { kind: 'relationship', npcId: 'v_noor', axes: { affection: 0.2, familiarity: 0.2 } },
    ],
  }),
  side({
    id: 's_shore_catch',
    chapter: 1,
    objectives: [
      {
        id: 'fish',
        kind: 'work_shift',
        labelKey: 'obj.s_shore_catch.fish',
        taskId: 'activity_fishing',
      },
      {
        id: 'sell',
        kind: 'deliver',
        labelKey: 'obj.s_shore_catch.sell',
        place: 'grocery_counter',
        itemId: 'fish_small',
      },
    ],
    money: 16,
    consequences: [{ kind: 'reputation', axis: 'community', delta: 0.03 }],
  }),
  side({
    id: 's_school_run',
    chapter: 2,
    minAge: 16,
    objectives: [
      { id: 'papers', kind: 'collect', labelKey: 'obj.s_school_run.papers', itemId: 'documents', count: 2 },
      { id: 'hall', kind: 'deliver', labelKey: 'obj.s_school_run.hall', place: 'village_hall', itemId: 'documents' },
    ],
    money: 18,
    consequences: [
      { kind: 'relationship', npcId: 'v_eleni', axes: { trust: 0.2, respect: 0.15 } },
    ],
  }),
  side({
    id: 's_farm_hands',
    chapter: 2,
    minAge: 16,
    objectives: [
      { id: 'field', kind: 'travel', labelKey: 'obj.s_farm_hands.field', place: 'village_field' },
      { id: 'work', kind: 'interact', labelKey: 'obj.s_farm_hands.work', place: 'village_field', count: 4 },
    ],
    money: 32,
    consequences: [
      { kind: 'relationship', npcId: 'v_bashir', axes: { trust: 0.25, respect: 0.2 } },
      { kind: 'reputation', axis: 'community', delta: 0.05 },
    ],
  }),
  side({
    id: 's_workshop_hands',
    chapter: 2,
    minAge: 16,
    objectives: [
      { id: 'yard', kind: 'travel', labelKey: 'obj.s_workshop_hands.yard', place: 'village_garage' },
      { id: 'hold', kind: 'interact', labelKey: 'obj.s_workshop_hands.hold', place: 'garage_lift', count: 3 },
    ],
    money: 26,
    items: [{ id: 'repair_kit', count: 1 }],
    consequences: [{ kind: 'relationship', npcId: 'v_tomas', axes: { trust: 0.2 } }],
  }),
  side({
    id: 's_noor_study',
    chapter: 2,
    minAge: 16,
    objectives: [
      { id: 'meet', kind: 'talk', labelKey: 'obj.s_noor_study.meet', npcId: 'v_noor' },
      { id: 'quiet', kind: 'wait', labelKey: 'obj.s_noor_study.quiet', seconds: 45 },
    ],
    consequences: [
      { kind: 'relationship', npcId: 'v_noor', axes: { affection: 0.25, trust: 0.2 } },
      { kind: 'flag', id: 'noor_passed' },
    ],
  }),
  side({
    id: 's_bike_rival',
    chapter: 3,
    minAge: 17,
    requires: ['q2_the_bicycle'],
    objectives: [
      { id: 'line', kind: 'talk', labelKey: 'obj.s_bike_rival.line', npcId: 'v_liya' },
      { id: 'race', kind: 'drive', labelKey: 'obj.s_bike_rival.race', vehicleKind: 'bicycle', metres: 1500 },
    ],
    money: 24,
    consequences: [
      { kind: 'relationship', npcId: 'v_liya', axes: { respect: 0.3, familiarity: 0.2 } },
      { kind: 'reel', event: 'choice', textKey: 'reel.side.race' },
    ],
  }),
  side({
    id: 's_hill_lookout',
    chapter: 3,
    minAge: 17,
    objectives: [
      { id: 'climb', kind: 'travel', labelKey: 'obj.s_hill_lookout.climb', place: 'village_hill' },
      { id: 'look', kind: 'wait', labelKey: 'obj.s_hill_lookout.look', seconds: 20 },
    ],
    consequences: [
      { kind: 'flag', id: 'saw_the_horizon' },
      { kind: 'reel', event: 'choice', textKey: 'reel.side.hill' },
    ],
    sceneId: 'cs_the_lookout',
  }),
];

/** The city half. Bigger money, thinner gratitude. */
const CITY: readonly QuestDef[] = [
  side({
    id: 's_market_stock',
    chapter: 4,
    minAge: 18,
    objectives: [
      { id: 'yusuf', kind: 'talk', labelKey: 'obj.s_market_stock.yusuf', npcId: 'c_yusuf' },
      { id: 'boxes', kind: 'collect', labelKey: 'obj.s_market_stock.boxes', itemId: 'stock_box', count: 4 },
      { id: 'shelf', kind: 'interact', labelKey: 'obj.s_market_stock.shelf', place: 'grocery_aisle_a', count: 3 },
    ],
    money: 38,
    consequences: [{ kind: 'relationship', npcId: 'c_yusuf', axes: { trust: 0.2 } }],
  }),
  side({
    id: 's_garage_hands',
    chapter: 4,
    minAge: 18,
    objectives: [
      { id: 'priya', kind: 'talk', labelKey: 'obj.s_garage_hands.priya', npcId: 'c_priya' },
      { id: 'tow', kind: 'work_shift', labelKey: 'obj.s_garage_hands.tow', taskId: 'job_garage_recovery' },
    ],
    money: 30,
    consequences: [{ kind: 'relationship', npcId: 'c_priya', axes: { trust: 0.25, respect: 0.2 } }],
  }),
  side({
    id: 's_paperwork',
    chapter: 4,
    minAge: 18,
    objectives: [
      { id: 'dawit', kind: 'talk', labelKey: 'obj.s_paperwork.dawit', npcId: 'c_dawit' },
      { id: 'forms', kind: 'collect', labelKey: 'obj.s_paperwork.forms', itemId: 'documents', count: 2 },
      { id: 'file', kind: 'interact', labelKey: 'obj.s_paperwork.file', place: 'om_office', count: 2 },
    ],
    money: 34,
    consequences: [{ kind: 'flag', id: 'knows_the_registry' }],
  }),
  side({
    id: 's_cafe_shift',
    chapter: 4,
    minAge: 18,
    objectives: [
      { id: 'sana', kind: 'talk', labelKey: 'obj.s_cafe_shift.sana', npcId: 'c_sana' },
      { id: 'serve', kind: 'interact', labelKey: 'obj.s_cafe_shift.serve', place: 'cafe_counter', count: 4 },
    ],
    money: 28,
    consequences: [{ kind: 'relationship', npcId: 'c_sana', axes: { familiarity: 0.25, affection: 0.15 } }],
  }),
  side({
    id: 's_city_history',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'george', kind: 'talk', labelKey: 'obj.s_city_history.george', npcId: 'c_george' },
      { id: 'walk', kind: 'travel', labelKey: 'obj.s_city_history.walk', place: 'om_square' },
      { id: 'listen', kind: 'wait', labelKey: 'obj.s_city_history.listen', seconds: 35 },
    ],
    consequences: [
      { kind: 'relationship', npcId: 'c_george', axes: { familiarity: 0.3, trust: 0.25 } },
      { kind: 'flag', id: 'knows_city_history' },
    ],
  }),
  side({
    id: 's_night_shift',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'kenji', kind: 'talk', labelKey: 'obj.s_night_shift.kenji', npcId: 'c_kenji' },
      { id: 'run', kind: 'deliver', labelKey: 'obj.s_night_shift.run', place: 'dt_clinic', itemId: 'documents' },
    ],
    money: 42,
    consequences: [
      { kind: 'relationship', npcId: 'c_kenji', axes: { trust: 0.3 } },
      { kind: 'reputation', axis: 'community', delta: 0.05 },
    ],
  }),
  side({
    id: 's_petition',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'rosa', kind: 'talk', labelKey: 'obj.s_petition.rosa', npcId: 'c_rosa' },
      { id: 'doors', kind: 'interact', labelKey: 'obj.s_petition.doors', place: 'dt_plaza', count: 5 },
    ],
    money: 12,
    consequences: [
      { kind: 'relationship', npcId: 'c_rosa', axes: { trust: 0.3, respect: 0.25 } },
      { kind: 'reputation', axis: 'community', delta: 0.12 },
      { kind: 'flag', id: 'signed_the_petition' },
    ],
  }),
  side({
    id: 's_courier_chain',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'omar', kind: 'talk', labelKey: 'obj.s_courier_chain.omar', npcId: 'c_omar' },
      { id: 'chain', kind: 'work_shift', labelKey: 'obj.s_courier_chain.chain', taskId: 'job_city_courier' },
      { id: 'fast', kind: 'drive', labelKey: 'obj.s_courier_chain.fast', metres: 2000, optional: true },
    ],
    money: 46,
    consequences: [{ kind: 'relationship', npcId: 'c_omar', axes: { familiarity: 0.25, respect: 0.2 } }],
  }),
  side({
    id: 's_dock_cargo',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'marcel', kind: 'talk', labelKey: 'obj.s_dock_cargo.marcel', npcId: 'c_marcel' },
      { id: 'lift', kind: 'interact', labelKey: 'obj.s_dock_cargo.lift', place: 'wf_dock', count: 4 },
      { id: 'park', kind: 'park', labelKey: 'obj.s_dock_cargo.park', place: 'om_parking' },
    ],
    money: 52,
    consequences: [{ kind: 'relationship', npcId: 'c_marcel', axes: { respect: 0.25 } }],
  }),
  side({
    id: 's_ines_errand',
    chapter: 5,
    minAge: 19,
    objectives: [
      { id: 'ines', kind: 'talk', labelKey: 'obj.s_ines_errand.ines', npcId: 'c_ines' },
      { id: 'shop', kind: 'buy', labelKey: 'obj.s_ines_errand.shop', itemId: 'bread' },
      { id: 'home', kind: 'deliver', labelKey: 'obj.s_ines_errand.home', place: 'wf_market', itemId: 'bread' },
    ],
    money: 20,
    consequences: [
      { kind: 'relationship', npcId: 'c_ines', axes: { familiarity: 0.25, affection: 0.2 } },
      { kind: 'reputation', axis: 'community', delta: 0.04 },
    ],
  }),
];

export const SIDE_QUESTS: readonly QuestDef[] = [...VILLAGE, ...CITY];
