/**
 * Weapons, as data.
 *
 * **There is no health and no damage anywhere in this phase, and that is a
 * design decision rather than a euphemism.** What a hit takes is *composure*:
 * a 0..1 number that falls when somebody is shoved, startled or hit, and at
 * zero leaves them sitting down and out of the fight. They recover — at the
 * clinic, or on their own after a while. Nobody dies, nothing bleeds, and
 * there is no injury model to render.
 *
 * That is what "stylized, non-graphic, and never mandatory" in
 * `docs/GAME_VISION.md` has to mean once there are firearms in the box. It is
 * also cheaper and more testable than the alternative, which is the useful
 * kind of coincidence.
 *
 * Everything here is pure data and pure arithmetic. `WeaponSystem` owns the
 * state machine, `Ballistics` owns spread and recoil, and neither reads a
 * clock or touches a scene.
 */

export type WeaponId = 'unarmed' | 'pistol' | 'shotgun' | 'carbine';

export type WeaponClass = 'unarmed' | 'sidearm' | 'shotgun' | 'carbine';

/** The age every firearm is gated behind. Not negotiable; mirrors `Gates`. */
export const FIREARM_MIN_AGE = 18;

export interface RecoilSpec {
  /** Radians kicked up per shot. */
  readonly pitch: number;
  /** Radians of horizontal wander per shot, sign chosen by the seeded RNG. */
  readonly yaw: number;
  /** Fraction of accumulated recoil shed per second. */
  readonly recover: number;
}

export interface WeaponDef {
  readonly id: WeaponId;
  readonly displayName: string;
  readonly weaponClass: WeaponClass;

  /** Rounds in a full magazine. Zero for unarmed. */
  readonly magazine: number;
  /** Most rounds that can be carried outside the magazine. */
  readonly reserveMax: number;
  /** Inventory item that feeds it, or null. */
  readonly ammoItemId: string | null;

  readonly reloadSeconds: number;
  /** Seconds between shots. */
  readonly fireInterval: number;
  /** Projectiles per trigger pull. Eight makes a shotgun a shotgun. */
  readonly pellets: number;

  /** Cone half-angle in radians, hip-fired and at rest. */
  readonly baseSpread: number;
  /** Cone half-angle while aiming. Always tighter than `baseSpread`. */
  readonly aimSpread: number;
  /** Radians of extra cone added per shot fired. */
  readonly bloomPerShot: number;
  /** Fraction of accumulated bloom shed per second. */
  readonly bloomDecay: number;
  readonly recoil: RecoilSpec;

  /** Metres the hitscan reaches. */
  readonly range: number;
  /**
   * Composure removed by one projectile at point-blank, 0..1.
   *
   * Not damage. See the note at the top — a person at zero composure sits
   * down and later gets up, and there is no state below that.
   */
  readonly impact: number;
  /** Falls off linearly to this fraction of `impact` at maximum range. */
  readonly impactAtRange: number;

  /** Multiplier on walk speed while aiming this. */
  readonly moveScale: number;
  /** Metres the shot carries as a `gunshot` perception event. */
  readonly loudness: number;

  readonly minAge: number;
  /** Whether holding it visibly is itself an offence in a restricted place. */
  readonly conspicuous: boolean;
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/** Composure taken by one projectile at a given distance. */
export function impactAt(def: WeaponDef, distance: number): number {
  if (def.range <= 0) return 0;
  const t = Math.min(1, Math.max(0, distance / def.range));
  return def.impact * (1 - t * (1 - def.impactAtRange));
}

/** Is this weapon allowed at this age? */
export function ageAllows(def: WeaponDef, age: number): boolean {
  return age >= def.minAge;
}

export interface WeaponValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Catch the ways a weapon definition is quietly wrong.
 *
 * The two that matter are the last two. A weapon whose aimed cone is *wider*
 * than its hip cone punishes the player for aiming and nobody would notice for
 * a long time, and a firearm that forgets its age gate is the one bug in this
 * phase that must never ship.
 */
export function validateWeapon(def: WeaponDef): WeaponValidation {
  const errors: string[] = [];
  const bad = (m: string) => errors.push(`${def.id}: ${m}`);

  if (def.magazine < 0 || !Number.isSafeInteger(def.magazine)) bad('magazine is not a whole count');
  if (def.reserveMax < 0) bad('negative reserve');
  if (def.pellets < 1) bad('fires no projectiles');
  if (def.fireInterval <= 0) bad('non-positive fire interval');
  if (def.reloadSeconds < 0) bad('negative reload');
  if (def.range <= 0) bad('no range');
  if (def.impact <= 0 || def.impact > 1) bad('impact must be within 0..1');
  if (def.impactAtRange < 0 || def.impactAtRange > 1) bad('impactAtRange must be within 0..1');
  if (def.moveScale <= 0 || def.moveScale > 1) bad('moveScale must be within 0..1');

  if (def.magazine > 0 && def.ammoItemId === null) bad('takes a magazine but has no ammunition');
  if (def.magazine === 0 && def.ammoItemId !== null) bad('has ammunition but no magazine');

  if (def.aimSpread > def.baseSpread) bad('aiming widens the cone, which punishes aiming');
  if (def.weaponClass !== 'unarmed' && def.minAge < FIREARM_MIN_AGE) {
    bad(`a firearm gated below ${FIREARM_MIN_AGE}`);
  }

  return { ok: errors.length === 0, errors };
}
