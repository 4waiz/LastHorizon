/**
 * The village, behind a chunk boundary.
 *
 * The last big eager block, and the one that took the longest to argue for.
 * `village_coast` is the start zone — every session builds it, so splitting it
 * out cannot save a player from downloading it the way `CitySubsystem` saves a
 * session that never leaves home.
 *
 * What it does is move ~40 kB off `initial load`, which had 2.1 kB of headroom
 * left, and pay nothing for it. The village is built inside `ZoneManager.enter`
 * during the loading screen, and `Game.start` kicks this import off *before*
 * `AssetManager.loadAll()` — so it is fetched concurrently with 1.4 MB of GLB
 * and is resolved long before anything asks for it. Requested at the point of
 * use it would be a serial round trip in the middle of the loading screen;
 * requested early it is free.
 *
 * The whole village subtree hangs off this one class — `Terrain`,
 * `RoadSystem`, `Vegetation`, `Birds` and `Collectibles` are reachable through
 * nothing else — so one export moves all six files. `Interactable` and
 * `WorldStats` are type-only everywhere they are used and do not follow.
 */

export { World } from './World';
