/**
 * How the character looks at each age.
 *
 * The brief rules out one model per year, and for good reason: five stages of
 * a 5 k-triangle character is 25 k of GLB, sixty-six is 330 k. So a stage is
 * *not* a mesh — it is a set of proportion multipliers applied to one skeleton,
 * plus a hair variant and a couple of material shifts.
 *
 * That is also what makes acceptance criterion 1 achievable. Ageing 17 → 18
 * changes numbers on bones that already exist; there is no mesh to swap, no
 * skeleton to rebind, and therefore nothing to reload.
 *
 * Pure: proportions in, proportions out. Applying them to a rig is the
 * renderer's job.
 */

export type AgeStageId = 'teen' | 'youngAdult' | 'adult' | 'middleAged' | 'senior';

/**
 * Multipliers against the base rig, which is authored at young-adult scale.
 *
 * These are small on purpose. A teenager who is 8% shorter with slightly
 * narrower shoulders and a fractionally larger head reads as younger; one who
 * is 30% shorter reads as a child, which this game does not want given what
 * age 18 unlocks.
 */
export interface Proportions {
  /** Overall height. */
  readonly height: number;
  /** Shoulder width — the strongest single cue for age and build. */
  readonly shoulders: number;
  /** Head size relative to body. Larger reads younger. */
  readonly head: number;
  /** Limb length relative to torso. */
  readonly limb: number;
  /** Forward lean at the spine, radians. Rises with the last two stages. */
  readonly stoop: number;
}

export interface AgeStage {
  readonly id: AgeStageId;
  readonly minAge: number;
  /** Inclusive. `Infinity` for the last stage. */
  readonly maxAge: number;
  readonly label: string;
  readonly proportions: Proportions;
  readonly hair: string;
  readonly hairColour: string;
  /**
   * MVP polish level. The first two stages are finished art; the rest are
   * structurally supported so the framework spans 15–80 without pretending
   * they have been art-directed.
   */
  readonly polished: boolean;
}

export const AGE_STAGES: readonly AgeStage[] = [
  {
    id: 'teen',
    minAge: 15,
    maxAge: 17,
    label: 'Teenager',
    proportions: { height: 0.92, shoulders: 0.9, head: 1.06, limb: 0.95, stoop: 0 },
    hair: 'hair_shaggy',
    hairColour: '#3a2a20',
    polished: true,
  },
  {
    id: 'youngAdult',
    minAge: 18,
    maxAge: 24,
    label: 'Young adult',
    proportions: { height: 1, shoulders: 1, head: 1, limb: 1, stoop: 0 },
    hair: 'hair_short',
    hairColour: '#3a2a20',
    polished: true,
  },
  {
    id: 'adult',
    minAge: 25,
    maxAge: 39,
    label: 'Adult',
    proportions: { height: 1.01, shoulders: 1.04, head: 0.99, limb: 1, stoop: 0.01 },
    hair: 'hair_short',
    hairColour: '#33251c',
    polished: false,
  },
  {
    id: 'middleAged',
    minAge: 40,
    maxAge: 59,
    label: 'Middle-aged',
    proportions: { height: 1.0, shoulders: 1.04, head: 0.99, limb: 0.99, stoop: 0.035 },
    hair: 'hair_short',
    hairColour: '#4a423c',
    polished: false,
  },
  {
    id: 'senior',
    minAge: 60,
    maxAge: Number.POSITIVE_INFINITY,
    label: 'Senior',
    proportions: { height: 0.97, shoulders: 1.0, head: 1.01, limb: 0.98, stoop: 0.075 },
    hair: 'hair_short',
    hairColour: '#b9b2a8',
    polished: false,
  },
];

const FIRST = AGE_STAGES[0];
const LAST = AGE_STAGES[AGE_STAGES.length - 1];

/**
 * The stage an age falls in. Ages outside 15–80 clamp to the ends.
 *
 * Bands are half-open — `[minAge, maxAge + 1)` — because this is fed
 * *fractional* ages: blending across a boundary means asking about 17.5, and
 * an inclusive integer band leaves every fraction between 17 and 18 matching
 * nothing at all.
 */
export function stageForAge(age: number): AgeStage {
  if (!Number.isFinite(age)) return FIRST;
  for (const s of AGE_STAGES) {
    if (age >= s.minAge && age < s.maxAge + 1) return s;
  }
  return age < FIRST.minAge ? FIRST : LAST;
}

/** True when these two ages sit in different stages — i.e. a visible change. */
export function crossesStage(fromAge: number, toAge: number): boolean {
  return stageForAge(fromAge).id !== stageForAge(toAge).id;
}

export function lerpProportions(a: Proportions, b: Proportions, t: number): Proportions {
  const k = Math.min(1, Math.max(0, t));
  const mix = (x: number, y: number) => x + (y - x) * k;
  return {
    height: mix(a.height, b.height),
    shoulders: mix(a.shoulders, b.shoulders),
    head: mix(a.head, b.head),
    limb: mix(a.limb, b.limb),
    stoop: mix(a.stoop, b.stoop),
  };
}

/**
 * Proportions for an exact age, blended across a stage boundary.
 *
 * A hard switch at a birthday would pop the character a few centimetres taller
 * mid-frame. Blending across the last year of a stage means 17.6 is already
 * most of the way to the adult build, so the birthday itself is not a visible
 * jolt — which is what "without skeleton breakage" has to mean in practice.
 */
export function proportionsForAge(age: number, blendYears = 1): Proportions {
  const stage = stageForAge(age);
  if (!Number.isFinite(stage.maxAge)) return stage.proportions;

  const next = AGE_STAGES[AGE_STAGES.indexOf(stage) + 1];
  if (!next) return stage.proportions;

  // Blend over the final `blendYears` of the current stage.
  const blendStart = stage.maxAge + 1 - blendYears;
  if (age < blendStart) return stage.proportions;

  const t = (age - blendStart) / blendYears;
  return lerpProportions(stage.proportions, next.proportions, t);
}

/** Everything the renderer needs to present an age. */
export interface AppearanceTarget {
  readonly stage: AgeStage;
  readonly proportions: Proportions;
  readonly hair: string;
  readonly hairColour: string;
}

export function appearanceForAge(age: number, blendYears = 1): AppearanceTarget {
  const stage = stageForAge(age);
  return {
    stage,
    proportions: proportionsForAge(age, blendYears),
    hair: stage.hair,
    hairColour: stage.hairColour,
  };
}
