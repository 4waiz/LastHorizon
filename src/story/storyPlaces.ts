import type { ZoneId } from '../world/zones/Manifest';

/**
 * Named outdoor places the story points at.
 *
 * Quest objectives name a *place*, never a coordinate — the same discipline
 * the save format uses when it records a spawn id instead of a position, and
 * for the same reason: the world gets re-laid-out and the content should
 * survive it.
 *
 * These mirror the zone anchors `src/npc/npcCatalog.ts` already uses for
 * schedules, so a resident's "work" anchor and a quest's "go here" resolve to
 * the same spot rather than to two places six metres apart. `questPlaces.test.ts`
 * asserts that pairing holds.
 *
 * Interior points — `grocery_counter`, `garage_lift`, `apartment_bed` — are
 * **not** here. Those are resolved against whichever room is open, because
 * their position is a property of the built interior and not of the world.
 */

export interface StoryPlace {
  readonly zone: ZoneId;
  readonly x: number;
  readonly z: number;
  /** How close counts as "there". Generous: this is not a precision game. */
  readonly radius: number;
}

const at = (zone: ZoneId, x: number, z: number, radius = 6): StoryPlace => ({ zone, x, z, radius });

export const STORY_PLACES: Readonly<Record<string, StoryPlace>> = {
  // -- village -------------------------------------------------------------
  village_bench: at('village_coast', -7, 55),
  village_junction: at('village_coast', 14, 8),
  village_field: at('village_coast', 44, -8, 10),
  village_hill: at('village_coast', 58, -32, 12),
  village_yard: at('village_coast', -13, 30),
  village_hall: at('village_coast', 2, 22),
  village_garage: at('village_coast', 49, -16),
  village_stall: at('village_coast', 10, 14),
  village_home: at('village_coast', 15.2, -24.1, 8),
  village_far_house: at('village_coast', 67.4, -37.9, 8),
  village_farm: at('village_coast', 44, -8, 10),
  village_parking: at('village_coast', 12, 12, 7),
  fishing_spot: at('village_coast', -18, 62, 9),
  recovery_site: at('village_coast', 52, -24, 8),

  // -- old market ----------------------------------------------------------
  om_square: at('city_old_market', 12, 26),
  om_office: at('city_old_market', 24, 40),
  om_parking: at('city_old_market', -30, 8, 8),
  om_high_street: at('city_old_market', 0, 58),
  city_drop_a: at('city_old_market', 18, 20),
  city_drop_b: at('city_old_market', 22, 34),
  city_drop_c: at('city_old_market', -28, 14),
  taxi_pickup_a: at('city_old_market', 12, 26),
  taxi_drop_a: at('city_old_market', 0, 58),
  taxi_pickup_b: at('city_old_market', 24, 40),
  taxi_drop_b: at('city_old_market', -30, 8),
  taxi_pickup_c: at('city_old_market', 30, 52),
  taxi_drop_c: at('city_old_market', -40, 40),

  // -- downtown ------------------------------------------------------------
  dt_plaza: at('city_downtown', 20, 160),
  dt_clinic: at('city_downtown', 34, 176),
  dt_depot: at('city_downtown', 20, 120),
  dt_police: at('city_downtown', 26, 150),

  // -- waterfront ----------------------------------------------------------
  wf_dock: at('city_waterfront', -24, -120, 9),
  wf_market: at('city_waterfront', -20, -100),
  wf_promenade: at('city_waterfront', 0, -78),
};

export function storyPlace(name: string): StoryPlace | null {
  return STORY_PLACES[name] ?? null;
}

/** Every place a given zone owns. Used by the map and by the validator. */
export function placesInZone(zone: ZoneId): Array<{ name: string; place: StoryPlace }> {
  return Object.entries(STORY_PLACES)
    .filter(([, p]) => p.zone === zone)
    .map(([name, place]) => ({ name, place }));
}
