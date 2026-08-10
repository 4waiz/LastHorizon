/**
 * Everything about weapons and the police that a peaceful player never needs.
 *
 * The same split Phase 7 drew for interiors and Phase 8 drew for the story:
 * **what does the save layer touch on the first frame?** That, and only that,
 * is eager.
 *
 * Eager, in `CombatState.ts`: the two serialised blobs and four numbers the
 * HUD mirrors. `SaveService` has to carry a criminal record whether or not
 * anybody has drawn a weapon, and the Heat readout has to know whether to
 * appear before the combat chunk exists.
 *
 * Lazy, behind this file: the weapon catalogue, the state machine, the
 * ballistics, the crime table, the Heat model, the police AI and the director.
 * Fetched the first time a weapon is drawn or a crime is committed — which for
 * every player under eighteen, and most players over it, is never. The 65 kB
 * of weapon models is lazy for the same reason, in `AssetManager.loadWeapons`.
 */

export { CombatDirector, DEFAULT_ACCESSIBILITY, type CombatAccessibility, type CombatHost } from './CombatDirector';
export { WeaponSystem, type WeaponHost, type WeaponRefusal, type WeaponStance } from './WeaponSystem';
export { WEAPONS, weaponDef, FIREARM_IDS, AMMO_ITEM_IDS } from './weaponCatalog';
export {
  FIREARM_MIN_AGE,
  ageAllows,
  impactAt,
  validateWeapon,
  type WeaponDef,
  type WeaponId,
} from './WeaponDefinition';
export {
  assistDirection,
  coneDirection,
  traceShot,
  type Hit,
  type ShotTarget,
  type TraceResult,
} from './Ballistics';
export {
  HeatSystem,
  BELIEF_STALE_SECONDS,
  HEAT_DECAY_PER_SECOND,
  type HeatBelief,
  type HeatSaveData,
} from '../crime/Heat';
export {
  CRIMES,
  MAX_HEAT,
  crimeDef,
  validateCrime,
  type CrimeDef,
  type CrimeId,
  type EvidenceKind,
} from '../crime/CrimeDefinition';
export {
  PoliceSystem,
  PoliceUnit,
  HEAT_TIERS,
  tierFor,
  type OfficerSnapshot,
  type OfficerState,
  type PoliceLine,
  type PoliceWorld,
} from '../crime/PoliceSystem';
