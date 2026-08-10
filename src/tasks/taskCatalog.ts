/**
 * The five job loops and the calm activity.
 *
 * Places are names, not positions: `job_parcel_delivery` asks for
 * `village_farm`, and the host resolves that against whatever zone is loaded.
 * That is what lets the same courier job exist in the village and the city
 * without two definitions.
 *
 * Timers, and their absence:
 *
 * | Task | Timer | Why |
 * | --- | --- | --- |
 * | grocery shift | none | doing the work well is the job |
 * | parcel delivery | none | a village round, not a race |
 * | city courier | 4 min | being quick *is* the job |
 * | taxi driving | 5 min | a fare that never ends is not a fare |
 * | garage recovery | none | towing a wreck carefully |
 * | fishing | none | the whole point |
 */

import type { TaskDef } from './TaskDefinition';
import { registerTasks } from './taskRegistry';

const GROCERY_SHIFT: TaskDef = {
  id: 'job_grocery_shift',
  name: 'Shop shift',
  summary: 'Stock the shelves and work the till until closing.',
  kind: 'job',
  objectives: [
    { id: 'fetch', kind: 'collect', label: 'Take three boxes from the back', itemId: 'stock_box', count: 3 },
    { id: 'stock_a', kind: 'interact', label: 'Stock the first aisle', place: 'grocery_aisle_a', count: 2 },
    { id: 'stock_b', kind: 'interact', label: 'Stock the second aisle', place: 'grocery_aisle_b', count: 1 },
    { id: 'till', kind: 'interact', label: 'Serve at the till', place: 'grocery_counter', count: 3 },
  ],
  timeLimit: null,
  basePay: 45,
  scaling: { pay: 0.2, time: 0 },
  retryable: true,
  startPoint: 'grocery_shift',
};

const PARCEL_DELIVERY: TaskDef = {
  id: 'job_parcel_delivery',
  name: 'Parcel round',
  summary: 'Take two parcels out to the farm and the far houses.',
  kind: 'job',
  objectives: [
    { id: 'load', kind: 'collect', label: 'Load two parcels', itemId: 'parcel', count: 2 },
    { id: 'drop_farm', kind: 'deliver', label: 'Drop one at the farm', place: 'village_farm', itemId: 'parcel' },
    { id: 'drop_house', kind: 'deliver', label: 'Drop one at the far house', place: 'village_far_house', itemId: 'parcel' },
  ],
  timeLimit: null,
  basePay: 30,
  scaling: { pay: 0.25, time: 0 },
  retryable: true,
  startPoint: 'grocery_shift',
};

const CITY_COURIER: TaskDef = {
  id: 'job_city_courier',
  name: 'City courier',
  summary: 'Three drops across the district, and the clock is running.',
  kind: 'job',
  objectives: [
    { id: 'load', kind: 'collect', label: 'Collect the run', itemId: 'parcel', count: 3 },
    { id: 'drop_1', kind: 'deliver', label: 'First drop', place: 'city_drop_a', itemId: 'parcel' },
    { id: 'drop_2', kind: 'deliver', label: 'Second drop', place: 'city_drop_b', itemId: 'parcel' },
    { id: 'drop_3', kind: 'deliver', label: 'Third drop', place: 'city_drop_c', itemId: 'parcel' },
  ],
  timeLimit: 240,
  basePay: 55,
  scaling: { pay: 0.2, time: 0.12 },
  retryable: true,
  startPoint: 'airstrip_desk',
  minAge: 16,
};

const TAXI_DRIVING: TaskDef = {
  id: 'job_taxi_driving',
  name: 'Taxi shift',
  summary: 'Pick up three fares and get them where they are going.',
  kind: 'job',
  objectives: [
    { id: 'fare_1', kind: 'goto', label: 'Collect the first fare', place: 'taxi_pickup_a' },
    { id: 'drop_1', kind: 'goto', label: 'Drop them off', place: 'taxi_drop_a' },
    { id: 'fare_2', kind: 'goto', label: 'Collect the second fare', place: 'taxi_pickup_b' },
    { id: 'drop_2', kind: 'goto', label: 'Drop them off', place: 'taxi_drop_b' },
    { id: 'fare_3', kind: 'goto', label: 'Collect the last fare', place: 'taxi_pickup_c' },
    { id: 'drop_3', kind: 'goto', label: 'Drop them off', place: 'taxi_drop_c' },
  ],
  timeLimit: 300,
  basePay: 12,
  scaling: { pay: 0.3, time: 0.1 },
  retryable: true,
  startPoint: 'garage_desk',
  minAge: 18,
  requiresVehicle: true,
};

const GARAGE_RECOVERY: TaskDef = {
  id: 'job_garage_recovery',
  name: 'Recovery call',
  summary: 'Fetch a stranded vehicle and bring it back to the bay.',
  kind: 'job',
  objectives: [
    { id: 'reach', kind: 'goto', label: 'Reach the stranded vehicle', place: 'recovery_site' },
    { id: 'hook', kind: 'interact', label: 'Hook it up', place: 'recovery_site' },
    { id: 'return', kind: 'deliver', label: 'Bring it to the bay', place: 'garage_lift', itemId: 'repair_kit' },
  ],
  timeLimit: null,
  basePay: 70,
  scaling: { pay: 0.15, time: 0 },
  retryable: true,
  startPoint: 'garage_lift',
  minAge: 16,
};

/**
 * The calm one.
 *
 * No timer, no failure state, and `retryable` is moot because it cannot fail.
 * The full activity expansion is Phase 10's; this is the shape it will grow
 * into rather than a placeholder to throw away.
 */
const FISHING: TaskDef = {
  id: 'activity_fishing',
  name: 'Fishing',
  summary: 'Sit at the water and wait. Sell what you catch.',
  kind: 'activity',
  objectives: [
    { id: 'cast', kind: 'interact', label: 'Cast a line', place: 'fishing_spot' },
    { id: 'wait', kind: 'wait', label: 'Wait for a bite', seconds: 25 },
    { id: 'land', kind: 'collect', label: 'Land the catch', itemId: 'fish_small', count: 1 },
  ],
  timeLimit: null,
  basePay: 0,
  scaling: { pay: 0, time: 0 },
  retryable: true,
  startPoint: 'fishing_spot',
};

// ---------------------------------------------------------------------------
// Phase 10 — the activities the airstrip and the coast made possible
// ---------------------------------------------------------------------------
//
// All five reuse the five objective kinds that already exist. That is a
// deliberate refusal rather than a limitation: a `race` kind and a `photograph`
// kind would each need their own reporter, their own progress rule and their
// own save shape, and Phase 8 shipped three objective kinds whose reporters
// were never wired. A time trial is a sequence of `goto`s with a clock on it,
// and that is genuinely all it is.

const BICYCLE_TIME_TRIAL: TaskDef = {
  id: 'activity_time_trial',
  name: 'Coast road time trial',
  summary: 'Four markers along the coast road. Only the clock is watching.',
  kind: 'activity',
  objectives: [
    { id: 'm1', kind: 'goto', label: 'First marker', place: 'trial_marker_a' },
    { id: 'm2', kind: 'goto', label: 'Second marker', place: 'trial_marker_b' },
    { id: 'm3', kind: 'goto', label: 'Third marker', place: 'trial_marker_c' },
    { id: 'finish', kind: 'goto', label: 'Back to the start', place: 'trial_marker_a' },
  ],
  timeLimit: 150,
  basePay: 18,
  scaling: { pay: 0.25, time: 0.14 },
  retryable: true,
  startPoint: 'trial_marker_a',
  requiresVehicle: 'bicycle',
};

const CITY_ROAD_RACE: TaskDef = {
  id: 'activity_road_race',
  name: 'Old market circuit',
  summary: 'A closed course through the market, run against the clock.',
  kind: 'activity',
  objectives: [
    { id: 'lap1_a', kind: 'goto', label: 'Turn one', place: 'race_gate_a' },
    { id: 'lap1_b', kind: 'goto', label: 'Turn two', place: 'race_gate_b' },
    { id: 'lap1_c', kind: 'goto', label: 'Turn three', place: 'race_gate_c' },
    { id: 'lap2_a', kind: 'goto', label: 'Turn one again', place: 'race_gate_a' },
    { id: 'lap2_b', kind: 'goto', label: 'Turn two again', place: 'race_gate_b' },
    { id: 'line', kind: 'goto', label: 'Across the line', place: 'race_gate_c' },
  ],
  // A *closed course*, which is what keeps this legal and out of the crime
  // table. Racing on live roads is `dangerous_driving`, and Phase 9 already
  // has an opinion about that.
  timeLimit: 210,
  basePay: 42,
  scaling: { pay: 0.28, time: 0.12 },
  retryable: true,
  startPoint: 'race_gate_c',
  minAge: 18,
  requiresVehicle: true,
};

const PHOTOGRAPHY: TaskDef = {
  id: 'activity_photography',
  name: 'Photographs for the noticeboard',
  summary: 'Three places somebody in the village wants a picture of.',
  kind: 'activity',
  objectives: [
    { id: 'brief', kind: 'interact', label: 'Read the request', place: 'village_noticeboard' },
    { id: 'shot_1', kind: 'interact', label: 'The headland at the point', place: 'photo_headland' },
    { id: 'shot_2', kind: 'interact', label: 'The old market arch', place: 'photo_arch' },
    { id: 'shot_3', kind: 'interact', label: 'The strip from the ridge', place: 'photo_ridge' },
    { id: 'hand_in', kind: 'goto', label: 'Take them back', place: 'village_noticeboard' },
  ],
  timeLimit: null,
  basePay: 26,
  scaling: { pay: 0.2, time: 0 },
  retryable: true,
  startPoint: 'village_noticeboard',
};

const SCENIC_FLIGHT: TaskDef = {
  id: 'activity_scenic_flight',
  name: 'Scenic flight',
  summary: 'Take a visitor over the coast and bring them back in one piece.',
  kind: 'activity',
  objectives: [
    { id: 'board', kind: 'goto', label: 'Collect your passenger', place: 'airstrip_apron' },
    { id: 'point', kind: 'goto', label: 'Over the headland', place: 'photo_headland' },
    { id: 'bay', kind: 'goto', label: 'Along the bay', place: 'waterfront_dock' },
    { id: 'home', kind: 'goto', label: 'Back to the strip', place: 'airstrip_apron' },
  ],
  // No clock. A scenic flight with a countdown is a delivery, and the point of
  // this one is the view.
  timeLimit: null,
  basePay: 60,
  scaling: { pay: 0.22, time: 0 },
  retryable: true,
  startPoint: 'airstrip_desk',
  minAge: 18,
  requiresVehicle: 'plane',
};

const AIR_DELIVERY: TaskDef = {
  id: 'activity_air_delivery',
  name: 'Air delivery',
  summary: 'Two crates the road cannot reach today, and weather coming in.',
  kind: 'activity',
  objectives: [
    { id: 'load', kind: 'collect', label: 'Load the crates', itemId: 'parcel', count: 2 },
    { id: 'drop_1', kind: 'deliver', label: 'Drop at the ridge', place: 'photo_ridge', itemId: 'parcel' },
    { id: 'drop_2', kind: 'deliver', label: 'Drop at the dock', place: 'waterfront_dock', itemId: 'parcel' },
    { id: 'home', kind: 'goto', label: 'Back to the strip', place: 'airstrip_apron' },
  ],
  timeLimit: 420,
  basePay: 85,
  scaling: { pay: 0.24, time: 0.1 },
  retryable: true,
  startPoint: 'airstrip_desk',
  minAge: 18,
  requiresVehicle: 'plane',
};

const POLICE_ESCAPE: TaskDef = {
  id: 'activity_police_escape',
  name: 'Shake them off',
  summary: 'A friendly bet with the off-duty sergeant. Stay ahead for two minutes.',
  kind: 'activity',
  objectives: [
    { id: 'start', kind: 'interact', label: 'Take the bet', place: 'police_desk' },
    { id: 'run', kind: 'wait', label: 'Stay ahead of them', seconds: 120 },
    { id: 'back', kind: 'goto', label: 'Back to the station to collect', place: 'police_desk' },
  ],
  // Free Roam only, and *authored as a game* rather than as a crime: the
  // sergeant is off duty and it is a bet. Phase 9's Heat is not involved,
  // because a challenge that leaves the player with a criminal record is not
  // a challenge, it is a trap.
  timeLimit: null,
  basePay: 40,
  scaling: { pay: 0.3, time: 0 },
  retryable: true,
  startPoint: 'police_desk',
  minAge: 18,
};

export const TASKS: readonly TaskDef[] = [
  GROCERY_SHIFT,
  PARCEL_DELIVERY,
  CITY_COURIER,
  TAXI_DRIVING,
  GARAGE_RECOVERY,
  FISHING,
  BICYCLE_TIME_TRIAL,
  CITY_ROAD_RACE,
  PHOTOGRAPHY,
  SCENIC_FLIGHT,
  AIR_DELIVERY,
  POLICE_ESCAPE,
];

const BY_ID = new Map(TASKS.map((t) => [t.id, t]));

export function taskDef(id: string): TaskDef | null {
  return BY_ID.get(id) ?? null;
}

export const JOB_IDS: readonly string[] = TASKS.filter((t) => t.kind === 'job').map((t) => t.id);

/**
 * Publish to the eager registry as a side effect of being imported.
 *
 * This is the only thing that populates `taskRegistry`, which is what makes
 * "the runtime looks the catalogue up, the catalogue is not on the startup
 * path" true by construction rather than by everyone remembering to call a
 * setup function. `storyValidation.ts` and the unit tests import `TASKS`
 * directly and get the registration for free.
 */
registerTasks(TASKS);
