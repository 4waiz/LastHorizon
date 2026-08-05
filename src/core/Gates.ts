import type { ZoneId } from '../world/zones/Manifest';

/**
 * Age and mode gates, in one place.
 *
 * The brief asks for these to be "typed gates, not scattered conditionals",
 * and the reason is concrete: `if (age >= 18)` sprinkled across a weapon shop,
 * a crime system and a zone door is four chances to write `>` instead of `>=`,
 * and no way to answer "what exactly is locked right now?" for the UI.
 *
 * So every gated capability is named, every decision returns a *reason*, and
 * the UI can render the reason instead of inventing its own copy of the rule.
 *
 * Pure data in, verdict out — no clocks, no save service, no DOM.
 */

export type GameMode = 'story' | 'freeRoam';

/** The age at which adult-only systems become available. Not negotiable. */
export const ADULT_AGE = 18;

/** Chapter that must be finished before the city opens in Story Mode. */
export const VILLAGE_DEPARTURE_CHAPTER = 'village_departure';

/**
 * Everything that can be locked.
 *
 * Adding a member forces every `switch` over it to be updated, which is the
 * point: a new gated system cannot quietly default to "allowed".
 */
export type Capability =
  | 'city_access'
  | 'weapons'
  | 'weapon_shops'
  | 'violent_crime'
  | 'drive_motor_vehicle'
  | 'drive_bicycle';

export interface GateContext {
  readonly mode: GameMode;
  readonly age: number;
  /** Chapter ids the player has completed. */
  readonly completedChapters: ReadonlySet<string>;
  /** Zones unlocked. Free Roam lets the player preset these. */
  readonly unlockedZones: ReadonlySet<ZoneId>;
}

export interface GateVerdict {
  readonly allowed: boolean;
  /** Player-facing explanation. Present whenever `allowed` is false. */
  readonly reason?: string;
}

const ALLOW: GateVerdict = { allowed: true };
const deny = (reason: string): GateVerdict => ({ allowed: false, reason });

/**
 * Is a capability available?
 *
 * Adult gates are checked on age alone and apply in **both** modes. Free Roam
 * lets the player choose a starting age, which is the supported way to reach
 * them — not a mode that skips the rule.
 */
export function can(capability: Capability, ctx: GateContext): GateVerdict {
  switch (capability) {
    case 'weapons':
    case 'weapon_shops':
    case 'violent_crime':
      return ctx.age >= ADULT_AGE
        ? ALLOW
        : deny(`Not until you are ${ADULT_AGE}.`);

    case 'drive_motor_vehicle':
      // A learner age, distinct from the adult gate.
      return ctx.age >= 17 ? ALLOW : deny('You are not old enough to drive yet.');

    case 'drive_bicycle':
      return ALLOW;

    case 'city_access':
      return cityAccess(ctx);
  }
}

/**
 * The city opens on age *and* story progress in Story Mode.
 *
 * Free Roam has no chapters, so it honours the player's chosen zone unlocks
 * instead — that is the whole point of the mode, and quietly applying a story
 * gate there would make the setup screen a lie.
 */
function cityAccess(ctx: GateContext): GateVerdict {
  if (ctx.mode === 'freeRoam') {
    return ctx.unlockedZones.has('city_old_market')
      ? ALLOW
      : deny('The city is not unlocked in this run.');
  }

  if (ctx.age < ADULT_AGE) {
    return deny(`The city is a long way to go at ${ctx.age}.`);
  }
  if (!ctx.completedChapters.has(VILLAGE_DEPARTURE_CHAPTER)) {
    return deny('There is something to finish in the village first.');
  }
  return ALLOW;
}

/** Zones that belong to the city, and so sit behind `city_access`. */
const CITY_ZONES: ReadonlySet<ZoneId> = new Set<ZoneId>([
  'city_old_market',
  'city_downtown',
  'city_waterfront',
]);

/**
 * May the player travel to this zone?
 *
 * Travel already refuses unknown or unplayable zones; this is the *narrative*
 * gate on top of that, so `TravelService` stays a mechanism and the rules live
 * here.
 */
export function canEnterZone(zone: ZoneId, ctx: GateContext): GateVerdict {
  if (zone === 'village_coast') return ALLOW;

  if (CITY_ZONES.has(zone)) {
    const city = can('city_access', ctx);
    if (!city.allowed) return city;
    // Districts beyond the first still need to be unlocked individually.
    return ctx.unlockedZones.has(zone) || zone === 'city_old_market'
      ? ALLOW
      : deny('You have not found your way there yet.');
  }

  if (zone === 'hill_airstrip') {
    return ctx.unlockedZones.has('hill_airstrip')
      ? ALLOW
      : deny('The airstrip is not open yet.');
  }

  return deny('There is no route there.');
}

/** Everything currently locked, for a settings or journal screen. */
export function lockedCapabilities(ctx: GateContext): Array<{ capability: Capability; reason: string }> {
  const all: Capability[] = [
    'city_access',
    'weapons',
    'weapon_shops',
    'violent_crime',
    'drive_motor_vehicle',
    'drive_bicycle',
  ];
  const out: Array<{ capability: Capability; reason: string }> = [];
  for (const c of all) {
    const v = can(c, ctx);
    if (!v.allowed) out.push({ capability: c, reason: v.reason ?? 'Locked.' });
  }
  return out;
}
