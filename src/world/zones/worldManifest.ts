import { buildChunkGrid, type WorldManifest, type ZoneManifest } from './Manifest';

/**
 * The world, as data.
 *
 * `village_coast` is the existing hand-authored neighbourhood, unchanged and
 * still the prologue: it is `kind: 'authored'`, so nothing streams and the
 * village builds exactly as it always has. The city is three streamed
 * districts. `hill_airstrip` is declared but not yet playable, so Phase 10 has
 * somewhere to attach without a manifest migration.
 *
 * Seeds are fixed literals. Every placement derives from them, so the world is
 * identical on every machine and every run.
 */

const VILLAGE_SEED = 0x1a570000;
const OLD_MARKET_SEED = 0x0d17_0001;
const DOWNTOWN_SEED = 0x0d17_0002;
const WATERFRONT_SEED = 0x0d17_0003;
const AIRSTRIP_SEED = 0x0a15_0001;

const CITY_CHUNK = 48;
/** Two rings, per the phase budget: at most a 5x5 block resident. */
const CITY_LOAD_RADIUS = 2;
/** Dead band beyond the load radius, in metres, so boundaries do not thrash. */
const CITY_HYSTERESIS = 14;

// ---------------------------------------------------------------------------
// village_coast — the existing world, described rather than changed
// ---------------------------------------------------------------------------

const village: ZoneManifest = {
  id: 'village_coast',
  displayName: 'Coastal Village',
  kind: 'authored',
  seed: VILLAGE_SEED,
  chunkSize: 0,
  loadRadius: 0,
  unloadHysteresis: 0,
  // Matches the terrain footprint the village is authored into.
  bounds: { minX: -128, minZ: -128, maxX: 128, maxZ: 128 },
  spawns: [
    // The authored start, matching World.spawn / World.spawnFacing.
    { id: 'village_start', x: 5.4, z: -39.3, facing: Math.PI, vehicleSafe: true, clearance: 3.0 },
    // Where the road leaves toward the city; also the arrival point coming back.
    { id: 'village_road_north', x: -14.0, z: 68.0, facing: 0, vehicleSafe: true, clearance: 4.0 },
    { id: 'village_hill', x: 60.0, z: -34.0, facing: -0.6, vehicleSafe: false, clearance: 1.6 },
  ],
  defaultSpawnId: 'village_start',
  chunks: [],
  interiors: [
    { id: 'village_home', x: -11.8, z: 60.6, interiorId: 'room_shared', prompt: 'Go inside' },
  ],
  lanes: [
    { id: 'v_lane_0', x: 5.0, z: -40.0, next: ['v_lane_1'], speedLimit: 12 },
    { id: 'v_lane_1', x: 0.0, z: 0.0, next: ['v_lane_2'], speedLimit: 12 },
    { id: 'v_lane_2', x: -12.0, z: 50.0, next: ['v_lane_3'], speedLimit: 12 },
    { id: 'v_lane_3', x: -14.0, z: 68.0, next: [], speedLimit: 12 },
  ],
  // Two places a villager would actually step across the road: outside the
  // hero row of houses, and just south of the side-road junction.
  crossings: [
    { id: 'v_cross_houses', ax: -7.5, az: 50, bx: 6.5, bz: 50 },
    { id: 'v_cross_junction', ax: -8.5, az: 14, bx: 5.5, bz: 14 },
  ],
  ambientAreas: [
    { id: 'v_amb_row', x: -6, z: 46, radius: 22, weight: 3 },
    { id: 'v_amb_junction', x: 12, z: 8, radius: 20, weight: 2 },
    { id: 'v_amb_sideroad', x: 52, z: -22, radius: 18, weight: 1 },
  ],
  audio: { zoneTrack: 'outdoor', ambience: ['cicadas', 'wind', 'birds'], reverb: 0.12 },
  weather: { windStrength: 1.0, fogFar: 560, defaultTimeMode: 'cycle' },
  bundles: ['village_kit'],
  neighbours: ['city_old_market'],
  playable: true,
};

// ---------------------------------------------------------------------------
// city districts — streamed
// ---------------------------------------------------------------------------

const oldMarketBounds = { minX: -96, minZ: -48, maxX: 96, maxZ: 96 };
const downtownBounds = { minX: -96, minZ: 96, maxX: 96, maxZ: 240 };
const waterfrontBounds = { minX: -96, minZ: -192, maxX: 96, maxZ: -48 };

const oldMarket: ZoneManifest = {
  id: 'city_old_market',
  displayName: 'Old Market',
  kind: 'streamed',
  seed: OLD_MARKET_SEED,
  chunkSize: CITY_CHUNK,
  loadRadius: CITY_LOAD_RADIUS,
  unloadHysteresis: CITY_HYSTERESIS,
  bounds: oldMarketBounds,
  spawns: [
    // Arrival from the village road. Vehicle-safe: the player may drive in.
    { id: 'market_road_south', x: 0, z: -40, facing: 0, vehicleSafe: true, clearance: 4.0 },
    { id: 'market_square', x: 12, z: 24, facing: Math.PI, vehicleSafe: false, clearance: 2.0 },
    { id: 'market_parking', x: -30, z: 8, facing: Math.PI / 2, vehicleSafe: true, clearance: 5.0 },
  ],
  defaultSpawnId: 'market_road_south',
  chunks: buildChunkGrid('city_old_market', OLD_MARKET_SEED, CITY_CHUNK, oldMarketBounds),
  interiors: [
    { id: 'market_grocery', x: 18, z: 20, interiorId: 'shell_grocery', prompt: 'Enter the grocery' },
    { id: 'market_garage', x: -28, z: 14, interiorId: 'shell_garage', prompt: 'Enter the garage' },
  ],
  lanes: [
    { id: 'om_0', x: 0, z: -40, next: ['om_1'], speedLimit: 14 },
    { id: 'om_1', x: 0, z: 0, next: ['om_2', 'om_side_0'], speedLimit: 14 },
    { id: 'om_2', x: 0, z: 48, next: ['om_3'], speedLimit: 14 },
    { id: 'om_3', x: 0, z: 92, next: [], speedLimit: 14 },
    { id: 'om_side_0', x: -30, z: 8, next: ['om_side_1'], speedLimit: 10 },
    { id: 'om_side_1', x: -60, z: 8, next: [], speedLimit: 10 },
  ],
  // Across the main carriageway. ROAD_HALF is 5 m and the pavement is 2.2 m,
  // so an end at +-6.2 lands on the kerb rather than in the gutter.
  crossings: [
    { id: 'om_cross_market', ax: -6.2, az: 22, bx: 6.2, bz: 22 },
    { id: 'om_cross_south', ax: -6.2, az: -18, bx: 6.2, bz: -18 },
    { id: 'om_cross_side', ax: -34, az: -6.2, bx: -34, bz: 6.2 },
  ],
  ambientAreas: [
    { id: 'om_amb_square', x: 12, z: 24, radius: 20, weight: 4 },
    { id: 'om_amb_high_street', x: 0, z: 58, radius: 26, weight: 3 },
    { id: 'om_amb_parking', x: -30, z: 8, radius: 16, weight: 2 },
  ],
  audio: { zoneTrack: 'city', ambience: ['traffic_far', 'crowd_low'], reverb: 0.3 },
  weather: { windStrength: 0.6, fogFar: 420, defaultTimeMode: 'cycle' },
  bundles: ['city_kit'],
  neighbours: ['village_coast', 'city_downtown', 'city_waterfront'],
  playable: true,
};

const downtown: ZoneManifest = {
  id: 'city_downtown',
  displayName: 'Downtown',
  kind: 'streamed',
  seed: DOWNTOWN_SEED,
  chunkSize: CITY_CHUNK,
  loadRadius: CITY_LOAD_RADIUS,
  unloadHysteresis: CITY_HYSTERESIS,
  bounds: downtownBounds,
  spawns: [
    { id: 'downtown_south', x: 0, z: 104, facing: 0, vehicleSafe: true, clearance: 4.0 },
    { id: 'downtown_plaza', x: 20, z: 160, facing: Math.PI, vehicleSafe: false, clearance: 2.0 },
  ],
  defaultSpawnId: 'downtown_south',
  chunks: buildChunkGrid('city_downtown', DOWNTOWN_SEED, CITY_CHUNK, downtownBounds),
  interiors: [
    { id: 'downtown_police', x: 26, z: 150, interiorId: 'shell_police', prompt: 'Enter the station' },
    { id: 'downtown_apartment', x: -22, z: 140, interiorId: 'shell_apartment', prompt: 'Go up to the flat' },
  ],
  lanes: [
    { id: 'dt_0', x: 0, z: 104, next: ['dt_1'], speedLimit: 14 },
    { id: 'dt_1', x: 0, z: 160, next: ['dt_2'], speedLimit: 14 },
    { id: 'dt_2', x: 0, z: 232, next: [], speedLimit: 14 },
  ],
  crossings: [
    { id: 'dt_cross_plaza', ax: -6.2, az: 158, bx: 6.2, bz: 158 },
    { id: 'dt_cross_station', ax: -6.2, az: 130, bx: 6.2, bz: 130 },
    { id: 'dt_cross_north', ax: -6.2, az: 196, bx: 6.2, bz: 196 },
  ],
  ambientAreas: [
    { id: 'dt_amb_plaza', x: 20, z: 160, radius: 22, weight: 5 },
    { id: 'dt_amb_station', x: 24, z: 146, radius: 14, weight: 2 },
    { id: 'dt_amb_flats', x: -22, z: 140, radius: 18, weight: 3 },
    { id: 'dt_amb_north', x: 0, z: 206, radius: 24, weight: 2 },
  ],
  audio: { zoneTrack: 'city', ambience: ['traffic_near', 'crowd_mid'], reverb: 0.38 },
  weather: { windStrength: 0.5, fogFar: 380, defaultTimeMode: 'cycle' },
  bundles: ['city_kit'],
  neighbours: ['city_old_market'],
  playable: true,
};

const waterfront: ZoneManifest = {
  id: 'city_waterfront',
  displayName: 'Waterfront',
  kind: 'streamed',
  seed: WATERFRONT_SEED,
  chunkSize: CITY_CHUNK,
  loadRadius: CITY_LOAD_RADIUS,
  unloadHysteresis: CITY_HYSTERESIS,
  bounds: waterfrontBounds,
  spawns: [
    { id: 'waterfront_north', x: 0, z: -56, facing: Math.PI, vehicleSafe: true, clearance: 4.0 },
    { id: 'waterfront_dock', x: -24, z: -120, facing: 0, vehicleSafe: false, clearance: 2.2 },
  ],
  defaultSpawnId: 'waterfront_north',
  chunks: buildChunkGrid('city_waterfront', WATERFRONT_SEED, CITY_CHUNK, waterfrontBounds),
  interiors: [],
  lanes: [
    { id: 'wf_0', x: 0, z: -56, next: ['wf_1'], speedLimit: 12 },
    { id: 'wf_1', x: 0, z: -120, next: ['wf_2'], speedLimit: 12 },
    { id: 'wf_2', x: 0, z: -184, next: [], speedLimit: 12 },
  ],
  crossings: [{ id: 'wf_cross_dock', ax: -6.2, az: -112, bx: 6.2, bz: -112 }],
  ambientAreas: [
    { id: 'wf_amb_dock', x: -24, z: -120, radius: 20, weight: 3 },
    { id: 'wf_amb_promenade', x: 0, z: -78, radius: 24, weight: 2 },
  ],
  audio: { zoneTrack: 'city', ambience: ['gulls', 'water', 'traffic_far'], reverb: 0.22 },
  weather: { windStrength: 1.2, fogFar: 500, defaultTimeMode: 'cycle' },
  bundles: ['city_kit'],
  neighbours: ['city_old_market'],
  playable: true,
};

// ---------------------------------------------------------------------------
// hill_airstrip — declared, not yet playable (Phase 10)
// ---------------------------------------------------------------------------

const airstrip: ZoneManifest = {
  id: 'hill_airstrip',
  displayName: 'Hill Airstrip',
  kind: 'authored',
  seed: AIRSTRIP_SEED,
  chunkSize: 0,
  loadRadius: 0,
  unloadHysteresis: 0,
  bounds: { minX: 128, minZ: -128, maxX: 384, maxZ: 128 },
  spawns: [
    { id: 'airstrip_gate', x: 160, z: 0, facing: Math.PI / 2, vehicleSafe: true, clearance: 6.0 },
  ],
  defaultSpawnId: 'airstrip_gate',
  chunks: [],
  interiors: [],
  lanes: [],
  crossings: [],
  ambientAreas: [],
  audio: { zoneTrack: 'outdoor', ambience: ['wind'], reverb: 0.08 },
  weather: { windStrength: 1.4, fogFar: 620, defaultTimeMode: 'cycle' },
  bundles: ['airstrip_kit'],
  neighbours: ['village_coast'],
  playable: false,
};

// The village must list the airstrip back, or validation flags the edge as
// one-way. Declared here rather than inline so the asymmetry is obvious.
const villageWithAirstrip: ZoneManifest = {
  ...village,
  neighbours: [...village.neighbours, 'hill_airstrip'],
};

export const WORLD_MANIFEST: WorldManifest = {
  version: 1,
  startZone: 'village_coast',
  zones: [villageWithAirstrip, oldMarket, downtown, waterfront, airstrip],
};
