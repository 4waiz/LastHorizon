import type { StoryCondition } from './QuestDefinition';

/**
 * How a life is summed up at twenty-five.
 *
 * Three families, eleven variants. The families come from the one question
 * chapter 7 asks out loud — where do you live now — and the variants come from
 * everything the player never announced: what the record says, who is still
 * speaking to them, what is in the account, and whether the village would have
 * them back.
 *
 * **Order is the whole mechanism.** Variants are ranked most specific first
 * and the first whose condition holds wins, so the last entry in each family
 * is unconditional and is what an ordinary run gets. A family whose last
 * variant were conditional could match nothing and hand the player a blank
 * card, which is why `endingValidation` refuses one.
 */

export type EndingFamily = 'return_build' | 'stay_rise' | 'live_between';

export const ENDING_FAMILIES: readonly EndingFamily[] = [
  'return_build',
  'stay_rise',
  'live_between',
];

export interface EndingDef {
  readonly id: string;
  readonly family: EndingFamily;
  readonly titleKey: string;
  readonly bodyKey: string;
  /** Absent on the family's fallback, which must be last. */
  readonly requires?: StoryCondition;
}

/**
 * Thresholds, named once.
 *
 * Reputation runs 0..1 on both axes and starts at `law: 1, community: 0`, so
 * "clean" is a record nothing has dented and "trusted" is standing that had to
 * be earned across seven chapters. `RICH` is roughly two chapters of diligent
 * work above the cost of living — see `docs/ECONOMY_BALANCE.md` for what a
 * shift is worth.
 */
const CLEAN_RECORD = 0.9;
const MARKED_RECORD = 0.45;
const TRUSTED = 0.55;
const RESENTED = 0.15;
const RICH = 6000;
const COMFORTABLE = 1500;

/** Went home. */
const RETURN_AND_BUILD: readonly EndingDef[] = [
  {
    id: 'return_build_champion',
    family: 'return_build',
    titleKey: 'ending.return_build_champion.title',
    bodyKey: 'ending.return_build_champion.body',
    requires: {
      flags: ['ch6_protected'],
      minReputation: { community: TRUSTED, law: CLEAN_RECORD },
    },
  },
  {
    id: 'return_build_witness',
    family: 'return_build',
    titleKey: 'ending.return_build_witness.title',
    bodyKey: 'ending.return_build_witness.body',
    requires: { flags: ['ch6_exposed'], minReputation: { community: TRUSTED } },
  },
  {
    id: 'return_build_shadow',
    family: 'return_build',
    titleKey: 'ending.return_build_shadow.title',
    bodyKey: 'ending.return_build_shadow.body',
    requires: { maxReputation: { law: MARKED_RECORD } },
  },
  {
    id: 'return_build_debt',
    family: 'return_build',
    titleKey: 'ending.return_build_debt.title',
    bodyKey: 'ending.return_build_debt.body',
    requires: { maxReputation: { community: RESENTED } },
  },
  {
    id: 'return_build_quiet',
    family: 'return_build',
    titleKey: 'ending.return_build_quiet.title',
    bodyKey: 'ending.return_build_quiet.body',
  },
];

/**
 * Stayed in the city.
 *
 * `wanted` is ranked above `magnate` deliberately, and a test caught it being
 * the other way round. A player who is rich, resented *and* marked got "The
 * Office" — but in this family the money and the record are the same story,
 * and the record is the one that names it. Wealth acquired sideways reads as
 * the crime ending, not the business ending.
 */
const STAY_AND_RISE: readonly EndingDef[] = [
  {
    id: 'stay_rise_wanted',
    family: 'stay_rise',
    titleKey: 'ending.stay_rise_wanted.title',
    bodyKey: 'ending.stay_rise_wanted.body',
    requires: { maxReputation: { law: MARKED_RECORD } },
  },
  {
    id: 'stay_rise_magnate',
    family: 'stay_rise',
    titleKey: 'ending.stay_rise_magnate.title',
    bodyKey: 'ending.stay_rise_magnate.body',
    requires: { minMoney: RICH, maxReputation: { community: RESENTED } },
  },
  {
    id: 'stay_rise_respected',
    family: 'stay_rise',
    titleKey: 'ending.stay_rise_respected.title',
    bodyKey: 'ending.stay_rise_respected.body',
    requires: { minReputation: { community: TRUSTED, law: CLEAN_RECORD }, minMoney: COMFORTABLE },
  },
  {
    id: 'stay_rise_alone',
    family: 'stay_rise',
    titleKey: 'ending.stay_rise_alone.title',
    bodyKey: 'ending.stay_rise_alone.body',
    requires: { flags: ['ch5_alone'] },
  },
  {
    id: 'stay_rise_working',
    family: 'stay_rise',
    titleKey: 'ending.stay_rise_working.title',
    bodyKey: 'ending.stay_rise_working.body',
  },
];

/** Kept both. */
const LIVE_BETWEEN: readonly EndingDef[] = [
  {
    id: 'live_between_bridge',
    family: 'live_between',
    titleKey: 'ending.live_between_bridge.title',
    bodyKey: 'ending.live_between_bridge.body',
    requires: { minReputation: { community: TRUSTED, law: CLEAN_RECORD } },
  },
  {
    id: 'live_between_courier',
    family: 'live_between',
    titleKey: 'ending.live_between_courier.title',
    bodyKey: 'ending.live_between_courier.body',
    requires: { minMoney: COMFORTABLE, minReputation: { law: CLEAN_RECORD } },
  },
  {
    id: 'live_between_restless',
    family: 'live_between',
    titleKey: 'ending.live_between_restless.title',
    bodyKey: 'ending.live_between_restless.body',
  },
];

export const ENDINGS: readonly EndingDef[] = [
  ...RETURN_AND_BUILD,
  ...STAY_AND_RISE,
  ...LIVE_BETWEEN,
];

const BY_FAMILY: Readonly<Record<EndingFamily, readonly EndingDef[]>> = {
  return_build: RETURN_AND_BUILD,
  stay_rise: STAY_AND_RISE,
  live_between: LIVE_BETWEEN,
};

export function endingsOf(family: EndingFamily): readonly EndingDef[] {
  return BY_FAMILY[family];
}

export function endingById(id: string): EndingDef | null {
  return ENDINGS.find((e) => e.id === id) ?? null;
}

/**
 * Which family chapter 7 landed in.
 *
 * Reads the flag rather than the choice so that a run whose chapter-7 choice
 * was never recorded — a jump straight to the ending in test mode — still
 * resolves rather than throwing.
 */
export function familyFromFlags(has: (flag: string) => boolean): EndingFamily {
  if (has('ch7_return')) return 'return_build';
  if (has('ch7_stay')) return 'stay_rise';
  return 'live_between';
}

/**
 * Pick the variant.
 *
 * `test` is `QuestSystem.test`, passed in rather than reimplemented: an ending
 * condition and a branch condition are the same kind of thing, and two
 * evaluators would eventually disagree about what `minReputation` means.
 */
export function resolveEnding(
  family: EndingFamily,
  test: (c: StoryCondition | undefined) => boolean,
): EndingDef {
  const variants = BY_FAMILY[family];
  return variants.find((v) => test(v.requires)) ?? variants[variants.length - 1];
}
