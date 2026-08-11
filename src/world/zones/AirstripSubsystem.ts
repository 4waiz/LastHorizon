/**
 * The airstrip runtime, behind the zone-travel boundary.
 *
 * Same argument as `CitySubsystem`, and the same shape: a player who never
 * leaves the village never downloads a runway. Travel has already faded to
 * black and is preparing the destination when this is fetched, so the request
 * lands in a gap the player is waiting through either way.
 *
 * The 4.5 kB of headroom left on `initial load` after Phase 12 made this less
 * of a preference than an arithmetic constraint.
 */

export { AirstripRuntime } from './AirstripRuntime';
export { buildAirstrip } from './AirstripBuilder';
