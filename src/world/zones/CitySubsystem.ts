/**
 * The city runtime, behind the zone-travel boundary.
 *
 * Everything needed to stand up a district and stream its chunks, in one lazy
 * chunk fetched the first time somebody actually travels to one. A player who
 * spends the whole session in the village never downloads it — and in Story
 * Mode nobody can reach a district before eighteen anyway, which is a good
 * fraction of a run.
 *
 * **This split was named in the Phase 4 report and owed since then:** "if it
 * needs to go much higher, the answer is probably to split the city runtime
 * out behind the zone-travel boundary, where a load pause is already
 * expected." Phases 6, 7, 8, 9 and 11 each raised a ceiling instead. Phase 12
 * needed eager room for the service worker, the error screen and the save
 * sanitiser, and the rule in this repository is to move something before
 * raising a ceiling, so this is finally that move.
 *
 * The boundary is honest rather than convenient. `ZoneBuilder.buildZone` and
 * `buildChunk` have returned `Promise<void> | void` since Phase 2 and are
 * awaited by `ZoneManager`, so travel already has somewhere to put an await —
 * and it already fades to black and shows a transition while the destination
 * is prepared. The fetch lands in a gap the player was waiting through, which
 * is the same argument the interior kit makes for its 145 kB.
 */

export { CityRuntime } from './CityRuntime';
export { buildCityChunk, buildCitySkyline } from './CityBuilder';
