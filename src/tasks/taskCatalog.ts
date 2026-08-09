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

export const TASKS: readonly TaskDef[] = [
  GROCERY_SHIFT,
  PARCEL_DELIVERY,
  CITY_COURIER,
  TAXI_DRIVING,
  GARAGE_RECOVERY,
  FISHING,
];

const BY_ID = new Map(TASKS.map((t) => [t.id, t]));

export function taskDef(id: string): TaskDef | null {
  return BY_ID.get(id) ?? null;
}

export const JOB_IDS: readonly string[] = TASKS.filter((t) => t.kind === 'job').map((t) => t.id);
