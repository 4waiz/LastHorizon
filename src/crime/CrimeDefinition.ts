import type { PerceptionKind } from '../npc/Perception';

/**
 * The nine offences, and what each one leaves behind.
 *
 * The important field is `evidence`. A crime with witnesses is a crime the
 * police can be *told* about; a crime that leaves evidence is one they can
 * work out later. A crime with neither happened and nobody will ever know,
 * and the system has to be willing to say so — acceptance criterion 2 is
 * exactly the promise that an unwitnessed, evidence-free crime raises no Heat
 * at all.
 *
 * Severity is what a single confirmed report is worth in Heat, before witness
 * confidence scales it. The scale is 0..5 and the numbers are chosen so that:
 *
 * - shoplifting a loaf, seen clearly, is a 1 — somebody will have a word;
 * - taking a car, seen clearly, is a 2 — that is a call to the station;
 * - firing a weapon in a street is a 4 whoever sees it, because the *sound*
 *   carries 90 metres and a dozen people will phone at once;
 * - attacking a police officer is a 5 and skips the escalation ladder.
 */

export type CrimeId =
  | 'trespass'
  | 'shoplifting'
  | 'theft'
  | 'vehicle_theft'
  | 'dangerous_driving'
  | 'hit_and_run'
  | 'assault'
  | 'weapon_display'
  | 'weapon_discharge'
  | 'attack_police'
  | 'escape_arrest';

/**
 * How the police could come to know.
 *
 * `scene` is the one that makes the system fair: a smashed window or an
 * abandoned car is *there*, so an officer who walks past later finds it even
 * though nobody saw it happen. It is also the only path that can raise Heat
 * minutes after the fact, which is what stops "nobody saw me" from meaning
 * "nothing happened" for the crimes where it obviously should not.
 */
export type EvidenceKind = 'none' | 'scene' | 'victim' | 'property';

export interface CrimeDef {
  readonly id: CrimeId;
  readonly displayName: string;
  /** Heat a single fully-confident report is worth, 0..5. */
  readonly severity: number;
  /** What a witness would call it. Drives their reaction. */
  readonly perceivedAs: PerceptionKind;
  readonly evidence: EvidenceKind;
  /**
   * Seconds the evidence stays findable. Zero for `none`.
   *
   * A dropped wallet is found for a long time; a scuffle in a doorway stops
   * being obvious in a couple of minutes.
   */
  readonly evidenceSeconds: number;
  /** Fine in whole dollars, if the player settles it at the desk. */
  readonly fine: number;
  /** Reputation cost on the `law` axis the story reads. */
  readonly lawCost: number;
  /** Whether committing this can impound the vehicle involved. */
  readonly impounds: boolean;
  /**
   * Skips the escalation ladder and sets Heat directly.
   *
   * Only two do. Attacking an officer and running from an arrest are both
   * things every officer in the district hears about immediately, because the
   * officer involved is the one making the call.
   */
  readonly immediateHeat: number | null;
}

const crime = (
  id: CrimeId,
  displayName: string,
  severity: number,
  perceivedAs: PerceptionKind,
  evidence: EvidenceKind,
  evidenceSeconds: number,
  fine: number,
  lawCost: number,
  opts: { impounds?: boolean; immediateHeat?: number } = {},
): CrimeDef => ({
  id,
  displayName,
  severity,
  perceivedAs,
  evidence,
  evidenceSeconds,
  fine,
  lawCost,
  impounds: opts.impounds ?? false,
  immediateHeat: opts.immediateHeat ?? null,
});

export const CRIMES: readonly CrimeDef[] = [
  // Being somewhere you should not. Nothing is left behind, so this is the
  // purest test of "unwitnessed means unknown".
  crime('trespass', 'Trespass', 0.6, 'crime', 'none', 0, 40, 0.03),

  crime('shoplifting', 'Shoplifting', 1, 'theft', 'property', 180, 60, 0.05),
  crime('theft', 'Theft', 1.4, 'theft', 'property', 240, 90, 0.08),

  // A missing car is noticed whether or not the taking was seen.
  crime('vehicle_theft', 'Taking a vehicle', 2, 'theft', 'property', 600, 220, 0.12, {
    impounds: true,
  }),

  crime('dangerous_driving', 'Dangerous driving', 1.2, 'dangerous_driving', 'none', 0, 80, 0.05, {
    impounds: true,
  }),

  // Somebody is standing in the road afterwards. That is the evidence.
  crime('hit_and_run', 'Hit and run', 2.6, 'injured', 'victim', 300, 260, 0.18, {
    impounds: true,
  }),

  crime('assault', 'Assault', 2.4, 'crime', 'victim', 240, 200, 0.16),

  // Carrying it visibly where it is not welcome. Nothing is left behind, and
  // it is the one offence that stops the moment you put the thing away.
  crime('weapon_display', 'Carrying a weapon', 1.5, 'weapon_display', 'none', 0, 120, 0.08),

  // The sound is the witness. Ninety metres of it.
  crime('weapon_discharge', 'Firing a weapon', 3.2, 'gunshot', 'scene', 420, 400, 0.25),

  crime('attack_police', 'Attacking an officer', 5, 'gunshot', 'victim', 600, 700, 0.4, {
    immediateHeat: 5,
  }),

  crime('escape_arrest', 'Escaping arrest', 4, 'crime', 'none', 0, 500, 0.3, {
    immediateHeat: 4,
  }),
];

const BY_ID = new Map(CRIMES.map((c) => [c.id, c]));

export function crimeDef(id: string): CrimeDef | null {
  return BY_ID.get(id as CrimeId) ?? null;
}

export interface CrimeValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * The rules the table has to obey.
 *
 * The last check is the one with teeth: **a crime that leaves evidence must
 * say how long it lasts, and one that leaves none must not.** Getting that
 * pair wrong produces either evidence that never expires — so Heat can never
 * fall and the player can never escape — or evidence that expires instantly,
 * which quietly deletes the whole `scene` information path.
 */
export function validateCrime(def: CrimeDef): CrimeValidation {
  const errors: string[] = [];
  const bad = (m: string) => errors.push(`${def.id}: ${m}`);

  if (def.severity <= 0 || def.severity > 5) bad('severity must be within 0..5');
  if (def.fine < 0 || !Number.isSafeInteger(def.fine)) bad('fine is not whole dollars');
  if (def.lawCost < 0 || def.lawCost > 1) bad('lawCost must be within 0..1');
  if (def.immediateHeat !== null && (def.immediateHeat < 1 || def.immediateHeat > 5)) {
    bad('immediateHeat must be within 1..5');
  }
  if (def.evidence === 'none' && def.evidenceSeconds !== 0) {
    bad('leaves no evidence but claims a lifetime for it');
  }
  if (def.evidence !== 'none' && def.evidenceSeconds <= 0) {
    bad('leaves evidence that expires instantly, which deletes the scene path');
  }
  return { ok: errors.length === 0, errors };
}

/** Maximum Heat, and the top of every scale in this module. */
export const MAX_HEAT = 5;
