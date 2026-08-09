import type { DialogueChoice, DialogueNode, DialogueTree } from '../npc/Dialogue';
import type { Consequence } from './QuestDefinition';

/**
 * The authored conversations.
 *
 * These **widen** Phase 6's dialogue types rather than replacing them.
 * `StoryDialogueChoice extends DialogueChoice`, so a story tree *is* a
 * `DialogueTree` and `validateDialogue` — which already knows how to find a
 * conversation with no exit and a node nothing reaches — works on it unchanged.
 * `SMALL_TALK` keeps running through the same path it always did.
 *
 * **`text` holds a localisation key here and a sentence in `SMALL_TALK`, and
 * both are correct.** `t()` falls back to its argument, so a key resolves to
 * its string and a sentence resolves to itself. That is one field doing one
 * job — "the thing to display" — instead of a `text` and a `textKey` that can
 * disagree about which one wins.
 *
 * Nothing here is generated at runtime. Twenty residents inventing their own
 * lines is a different game with a different cost structure, and it is on the
 * deferred list in `docs/GAME_VISION.md`.
 */

export interface StoryDialogueChoice extends DialogueChoice {
  /** Applied by `QuestSystem.applyConsequence`, never by the panel. */
  readonly consequences?: readonly Consequence[];
  /** Hide entirely rather than grey out. For choices that would spoil. */
  readonly hideWhenUnavailable?: boolean;
}

export interface StoryDialogueNode extends DialogueNode {
  /** Resident id, `player`, or `narrator`. Drives the portrait and the name. */
  readonly speaker?: string;
  readonly choices: readonly StoryDialogueChoice[];
}

export interface StoryDialogueTree extends DialogueTree {
  readonly nodes: Readonly<Record<string, StoryDialogueNode>>;
}

/** Terser than repeating the object shape thirty times. */
const leave = (text = 'ui.dialogue.leave'): StoryDialogueChoice => ({ text, to: null });

// ---------------------------------------------------------------------------
// Chapter 1
// ---------------------------------------------------------------------------

const ELENI_KEEPSAKES: StoryDialogueTree = {
  id: 'dlg_eleni_keepsakes',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_eleni',
      text: 'dlg.eleni_keepsakes.open',
      choices: [
        { text: 'dlg.eleni_keepsakes.what', to: 'what' },
        { text: 'dlg.eleni_keepsakes.busy', to: null, effects: { affection: -0.02 } },
      ],
    },
    what: {
      id: 'what',
      speaker: 'v_eleni',
      text: 'dlg.eleni_keepsakes.what_a',
      effects: { familiarity: 0.05 },
      choices: [
        { text: 'dlg.eleni_keepsakes.ask_where', to: 'where', effects: { trust: 0.04 } },
        { text: 'dlg.eleni_keepsakes.ill_look', to: null, effects: { respect: 0.05 } },
      ],
    },
    where: {
      id: 'where',
      speaker: 'v_eleni',
      text: 'dlg.eleni_keepsakes.where_a',
      choices: [leave('dlg.eleni_keepsakes.go')],
    },
  },
};

const MARYAM_ERRAND: StoryDialogueTree = {
  id: 'dlg_maryam_errand',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_maryam',
      text: 'dlg.maryam_errand.open',
      choices: [
        { text: 'dlg.maryam_errand.take', to: 'take', effects: { familiarity: 0.04 } },
        leave(),
      ],
    },
    take: {
      id: 'take',
      speaker: 'v_maryam',
      text: 'dlg.maryam_errand.take_a',
      choices: [leave('dlg.maryam_errand.go')],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 2
// ---------------------------------------------------------------------------

const MARYAM_JOB: StoryDialogueTree = {
  id: 'dlg_maryam_job',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_maryam',
      text: 'dlg.maryam_job.open',
      choices: [
        { text: 'dlg.maryam_job.ask', to: 'terms', effects: { familiarity: 0.05 } },
        {
          text: 'dlg.maryam_job.ask_bold',
          to: 'terms',
          requires: { atLeast: { trust: 0.2 } },
          effects: { respect: 0.08 },
        },
        leave(),
      ],
    },
    terms: {
      id: 'terms',
      speaker: 'v_maryam',
      text: 'dlg.maryam_job.terms',
      choices: [
        { text: 'dlg.maryam_job.accept', to: null, effects: { trust: 0.1 } },
        { text: 'dlg.maryam_job.think', to: null },
      ],
    },
  },
};

const LIYA_ROUND: StoryDialogueTree = {
  id: 'dlg_liya_round',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_liya',
      text: 'dlg.liya_round.open',
      choices: [
        { text: 'dlg.liya_round.race', to: 'terms', effects: { respect: 0.06, familiarity: 0.05 } },
        { text: 'dlg.liya_round.just_help', to: 'terms', effects: { affection: 0.05 } },
      ],
    },
    terms: {
      id: 'terms',
      speaker: 'v_liya',
      text: 'dlg.liya_round.terms',
      choices: [leave('dlg.liya_round.go')],
    },
  },
};

/** The bicycle fork. This is where `ch2_bicycle` is actually written. */
const TOMAS_BICYCLE: StoryDialogueTree = {
  id: 'dlg_tomas_bicycle',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_tomas',
      text: 'dlg.tomas_bicycle.open',
      choices: [
        { text: 'dlg.tomas_bicycle.ask_fix', to: 'fix' },
        { text: 'dlg.tomas_bicycle.ask_buy', to: 'buy' },
        leave(),
      ],
    },
    fix: {
      id: 'fix',
      speaker: 'v_tomas',
      text: 'dlg.tomas_bicycle.fix_a',
      choices: [
        {
          text: 'dlg.tomas_bicycle.fix_yes',
          to: null,
          effects: { trust: 0.1, respect: 0.08 },
          consequences: [{ kind: 'choice', id: 'ch2_bicycle', value: 'fix' }],
        },
        { text: 'dlg.tomas_bicycle.back', to: 'open' },
      ],
    },
    buy: {
      id: 'buy',
      speaker: 'v_tomas',
      text: 'dlg.tomas_bicycle.buy_a',
      choices: [
        {
          text: 'dlg.tomas_bicycle.buy_yes',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch2_bicycle', value: 'buy' }],
        },
        { text: 'dlg.tomas_bicycle.back', to: 'open' },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 3
// ---------------------------------------------------------------------------

const TOMAS_LESSON: StoryDialogueTree = {
  id: 'dlg_tomas_lesson',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_tomas',
      text: 'dlg.tomas_lesson.open',
      choices: [
        { text: 'dlg.tomas_lesson.ready', to: 'rules', effects: { respect: 0.05 } },
        leave(),
      ],
    },
    rules: {
      id: 'rules',
      speaker: 'v_tomas',
      text: 'dlg.tomas_lesson.rules',
      choices: [leave('dlg.tomas_lesson.go')],
    },
  },
};

/** The mentor fork. Three answers, none of them wrong. */
const MENTOR_CHOICE: StoryDialogueTree = {
  id: 'dlg_mentor_choice',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'narrator',
      text: 'dlg.mentor_choice.open',
      choices: [
        { text: 'dlg.mentor_choice.trade', to: 'trade' },
        { text: 'dlg.mentor_choice.school', to: 'school' },
        { text: 'dlg.mentor_choice.road', to: 'road' },
        { text: 'dlg.mentor_choice.later', to: null },
      ],
    },
    trade: {
      id: 'trade',
      speaker: 'v_tomas',
      text: 'dlg.mentor_choice.trade_a',
      choices: [
        {
          text: 'dlg.mentor_choice.confirm',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch3_mentor', value: 'trade' }],
        },
        { text: 'dlg.mentor_choice.back', to: 'open' },
      ],
    },
    school: {
      id: 'school',
      speaker: 'v_eleni',
      text: 'dlg.mentor_choice.school_a',
      choices: [
        {
          text: 'dlg.mentor_choice.confirm',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch3_mentor', value: 'school' }],
        },
        { text: 'dlg.mentor_choice.back', to: 'open' },
      ],
    },
    road: {
      id: 'road',
      speaker: 'v_liya',
      text: 'dlg.mentor_choice.road_a',
      choices: [
        {
          text: 'dlg.mentor_choice.confirm',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch3_mentor', value: 'road' }],
        },
        { text: 'dlg.mentor_choice.back', to: 'open' },
      ],
    },
  },
};

const BASHIR_FIELD: StoryDialogueTree = {
  id: 'dlg_bashir_field',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_bashir',
      text: 'dlg.bashir_field.open',
      choices: [
        { text: 'dlg.bashir_field.whose', to: 'whose', effects: { familiarity: 0.05 } },
        { text: 'dlg.bashir_field.nothing', to: null },
      ],
    },
    whose: {
      id: 'whose',
      speaker: 'v_bashir',
      text: 'dlg.bashir_field.whose_a',
      effects: { trust: 0.06 },
      choices: [
        { text: 'dlg.bashir_field.ill_ask', to: null, effects: { trust: 0.08, respect: 0.05 } },
        leave(),
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 4
// ---------------------------------------------------------------------------

const LEAVING: StoryDialogueTree = {
  id: 'dlg_leaving',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_eleni',
      text: 'dlg.leaving.open',
      choices: [
        { text: 'dlg.leaving.thanks', to: 'letter', effects: { affection: 0.12, trust: 0.08 } },
        { text: 'dlg.leaving.quick', to: null, effects: { affection: -0.04 } },
      ],
    },
    letter: {
      id: 'letter',
      speaker: 'v_eleni',
      text: 'dlg.leaving.letter',
      choices: [leave('dlg.leaving.take_it')],
    },
  },
};

const DAWIT_LEASE: StoryDialogueTree = {
  id: 'dlg_dawit_lease',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'c_dawit',
      text: 'dlg.dawit_lease.open',
      choices: [
        { text: 'dlg.dawit_lease.ask', to: 'terms' },
        leave(),
      ],
    },
    terms: {
      id: 'terms',
      speaker: 'c_dawit',
      text: 'dlg.dawit_lease.terms',
      choices: [
        { text: 'dlg.dawit_lease.sign', to: null, effects: { familiarity: 0.08 } },
        { text: 'dlg.dawit_lease.haggle', to: 'haggle', effects: { respect: 0.05 } },
      ],
    },
    haggle: {
      id: 'haggle',
      speaker: 'c_dawit',
      text: 'dlg.dawit_lease.haggle_a',
      choices: [leave('dlg.dawit_lease.fine')],
    },
  },
};

const YUSUF_HIRE: StoryDialogueTree = {
  id: 'dlg_yusuf_hire',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'c_yusuf',
      text: 'dlg.yusuf_hire.open',
      choices: [
        { text: 'dlg.yusuf_hire.work', to: 'terms', effects: { familiarity: 0.06 } },
        { text: 'dlg.yusuf_hire.village', to: 'village', effects: { affection: 0.06 } },
        leave(),
      ],
    },
    village: {
      id: 'village',
      speaker: 'c_yusuf',
      text: 'dlg.yusuf_hire.village_a',
      effects: { trust: 0.06 },
      choices: [{ text: 'dlg.yusuf_hire.work', to: 'terms' }],
    },
    terms: {
      id: 'terms',
      speaker: 'c_yusuf',
      text: 'dlg.yusuf_hire.terms',
      choices: [leave('dlg.yusuf_hire.start')],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 5
// ---------------------------------------------------------------------------

/**
 * Omar's offer.
 *
 * The shortcut is stated plainly rather than hinted at. A branch whose cost is
 * hidden is not a choice, it is a trap, and the ending that reads `law` two
 * chapters later would come as a surprise the player never agreed to.
 */
const OMAR_SHORTCUT: StoryDialogueTree = {
  id: 'dlg_omar_shortcut',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'c_omar',
      text: 'dlg.omar_shortcut.open',
      choices: [
        { text: 'dlg.omar_shortcut.whats_in_it', to: 'terms' },
        { text: 'dlg.omar_shortcut.not_interested', to: 'straight' },
      ],
    },
    terms: {
      id: 'terms',
      speaker: 'c_omar',
      text: 'dlg.omar_shortcut.terms',
      choices: [
        {
          text: 'dlg.omar_shortcut.in',
          to: null,
          effects: { familiarity: 0.1 },
          consequences: [{ kind: 'choice', id: 'ch5_route', value: 'shortcut' }],
        },
        { text: 'dlg.omar_shortcut.out', to: 'straight' },
      ],
    },
    straight: {
      id: 'straight',
      speaker: 'c_omar',
      text: 'dlg.omar_shortcut.straight_a',
      choices: [
        {
          text: 'dlg.omar_shortcut.confirm_straight',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch5_route', value: 'straight' }],
        },
      ],
    },
  },
};

const SOMEONE: StoryDialogueTree = {
  id: 'dlg_someone',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'narrator',
      text: 'dlg.someone.open',
      choices: [
        {
          text: 'dlg.someone.sana',
          to: null,
          requires: { atLeast: { familiarity: 0.25 } },
          consequences: [{ kind: 'choice', id: 'ch5_someone', value: 'sana' }],
        },
        {
          text: 'dlg.someone.hana',
          to: null,
          requires: { atLeast: { familiarity: 0.25 } },
          consequences: [{ kind: 'choice', id: 'ch5_someone', value: 'hana' }],
        },
        {
          text: 'dlg.someone.noor',
          to: null,
          requires: { atLeast: { affection: 0.3 } },
          consequences: [{ kind: 'choice', id: 'ch5_someone', value: 'noor' }],
        },
        {
          text: 'dlg.someone.alone',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch5_someone', value: 'alone' }],
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 6
// ---------------------------------------------------------------------------

/** Five routes, stated as five sentences. Four of them are legal. */
const THE_OFFER: StoryDialogueTree = {
  id: 'dlg_the_offer',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_bashir',
      text: 'dlg.the_offer.open',
      choices: [
        { text: 'dlg.the_offer.what_now', to: 'routes', effects: { trust: 0.05 } },
        { text: 'dlg.the_offer.sorry', to: 'routes' },
      ],
    },
    routes: {
      id: 'routes',
      speaker: 'narrator',
      text: 'dlg.the_offer.routes',
      choices: [
        {
          text: 'dlg.the_offer.protect',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch6_route', value: 'protect' }],
        },
        {
          text: 'dlg.the_offer.law',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch6_route', value: 'law' }],
        },
        {
          text: 'dlg.the_offer.expose',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch6_route', value: 'expose' }],
        },
        {
          text: 'dlg.the_offer.exploit',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch6_route', value: 'exploit' }],
        },
        {
          text: 'dlg.the_offer.crime',
          to: null,
          requires: { minPlayerAge: 18 },
          consequences: [{ kind: 'choice', id: 'ch6_route', value: 'crime' }],
        },
      ],
    },
  },
};

// ---------------------------------------------------------------------------
// Chapter 7
// ---------------------------------------------------------------------------

const LAST_HORIZON: StoryDialogueTree = {
  id: 'dlg_last_horizon',
  root: 'open',
  nodes: {
    open: {
      id: 'open',
      speaker: 'v_eleni',
      text: 'dlg.last_horizon.open',
      choices: [
        { text: 'dlg.last_horizon.read', to: 'ask', effects: { affection: 0.08 } },
        { text: 'dlg.last_horizon.pocket', to: 'ask' },
      ],
    },
    ask: {
      id: 'ask',
      speaker: 'narrator',
      text: 'dlg.last_horizon.ask',
      choices: [
        {
          text: 'dlg.last_horizon.return',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch7_home', value: 'return' }],
        },
        {
          text: 'dlg.last_horizon.stay',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch7_home', value: 'stay' }],
        },
        {
          text: 'dlg.last_horizon.between',
          to: null,
          consequences: [{ kind: 'choice', id: 'ch7_home', value: 'between' }],
        },
      ],
    },
  },
};

export const DIALOGUE_TREES: readonly StoryDialogueTree[] = [
  ELENI_KEEPSAKES,
  MARYAM_ERRAND,
  MARYAM_JOB,
  LIYA_ROUND,
  TOMAS_BICYCLE,
  TOMAS_LESSON,
  MENTOR_CHOICE,
  BASHIR_FIELD,
  LEAVING,
  DAWIT_LEASE,
  YUSUF_HIRE,
  OMAR_SHORTCUT,
  SOMEONE,
  THE_OFFER,
  LAST_HORIZON,
];

const BY_ID = new Map(DIALOGUE_TREES.map((t) => [t.id, t]));

export function dialogueTree(id: string): StoryDialogueTree | null {
  return BY_ID.get(id) ?? null;
}
