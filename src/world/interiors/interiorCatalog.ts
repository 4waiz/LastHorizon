/**
 * The nine enterable services.
 *
 * Layouts, not geometry: every room here is a set of grid cells plus a list of
 * kit parts placed in room-local metres. Walls come from the cell set (see
 * `wallRuns`), the entry spawn comes from the door edge (`entrySpawn`), and
 * `validateInterior` refuses a prop that would stand in the void — which is
 * what makes authoring nine rooms in one file safe rather than reckless.
 *
 * Room-local space: cell (cx, cz) is centred at (cx * 2, cz * 2) with the
 * floor at y = 0. Every door here is on the room's +Z edge, so the player
 * always enters walking toward -Z and `facing` is π.
 *
 * A prop against a wall sits at (wall ± its own half-depth) with the yaw that
 * turns its front into the room: yaw 0 faces +Z, π faces -Z, π/2 faces +X.
 */

import { SERVICE_HOURS, type InteriorDef } from './InteriorDefinition';

const HALF_PI = Math.PI / 2;

/** A rectangle of cells, which is what every one of these rooms is. */
function rect(w: number, d: number): { x: number; z: number }[] {
  const out: { x: number; z: number }[] = [];
  for (let z = 0; z < d; z++) for (let x = 0; x < w; x++) out.push({ x, z });
  return out;
}

// ---------------------------------------------------------------------------
// 1. Family home — the village house you can already walk into
// ---------------------------------------------------------------------------

const HOME: InteriorDef = {
  id: 'home',
  name: 'Family home',
  service: 'home',
  floor: 'KitFloor',
  cells: rect(3, 2),
  door: { x: 1, z: 1, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 2, z: 0, side: 'n' },
  ],
  // A hero interior: this is the room the player wakes up in, and the one the
  // window portal was built for in Phase 4.
  livePortal: true,
  audio: 'home',
  hours: SERVICE_HOURS.home,
  props: [
    { part: 'KitBed', x: 4.3, z: 0.3 },
    { part: 'KitWardrobe', x: 0.0, z: -0.55 },
    { part: 'KitDesk', x: -0.5, z: 1.4, yaw: HALF_PI },
    { part: 'KitChair', x: 0.35, z: 1.4, yaw: -HALF_PI },
    { part: 'KitTable', x: 2.0, z: 0.4 },
    { part: 'KitStool', x: 2.0, z: 1.3 },
    { part: 'KitShelf', x: 0.2, z: 2.7, yaw: Math.PI },
    { part: 'KitPlanter', x: 4.4, z: 2.5 },
  ],
  points: [
    {
      id: 'home_bed',
      kind: 'bed',
      x: 4.3,
      y: 0.7,
      z: 0.3,
      radius: 1.7,
      prompt: 'Sleep',
      priority: 30,
    },
    { id: 'home_wardrobe', kind: 'wardrobe', x: 0.0, z: -0.55, y: 1.05, radius: 1.5, prompt: 'Open the wardrobe' },
    { id: 'home_chair', kind: 'chair', x: 0.35, z: 1.4, y: 0.5, radius: 1.2, prompt: 'Sit down', facing: -HALF_PI },
    { id: 'home_desk', kind: 'save', x: -0.5, z: 1.4, y: 0.8, radius: 1.4, prompt: 'Write the day down', service: 'home_save' },
  ],
  workPoints: [{ id: 'home_kitchen', x: 2.0, z: 1.3, facing: 0, role: 'resident' }],
  lights: [
    { x: 2.0, y: 2.6, z: 0.6, colour: 0xffe0ad, power: 13 },
    { x: 4.3, y: 1.1, z: -0.6, colour: 0xffd39a, power: 5.5 },
  ],
};

// ---------------------------------------------------------------------------
// 2. Grocery store
// ---------------------------------------------------------------------------

const GROCERY: InteriorDef = {
  id: 'grocery',
  name: 'Village grocery',
  service: 'grocery',
  floor: 'KitFloorTile',
  cells: rect(4, 3),
  door: { x: 1, z: 2, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 3, z: 0, side: 'n' },
    { x: 3, z: 1, side: 'e' },
  ],
  livePortal: false,
  audio: 'shop',
  hours: SERVICE_HOURS.grocery,
  props: [
    { part: 'KitCounter', x: 5.0, z: 3.4 },
    { part: 'KitTill', x: 5.0, z: 3.3, y: 1.01 },
    { part: 'KitFridge', x: 0.5, z: -0.5 },
    { part: 'KitFridge', x: 2.4, z: -0.5 },
    // Two back-to-back aisles. Their half-depths meet exactly, so the pair
    // reads as one island rather than two shelves with a gap behind them.
    { part: 'KitShelf', x: 0.8, z: 1.2 },
    { part: 'KitShelf', x: 0.8, z: 1.66, yaw: Math.PI },
    { part: 'KitShelf', x: 3.6, z: 1.2 },
    { part: 'KitShelf', x: 3.6, z: 1.66, yaw: Math.PI },
    { part: 'KitCrate', x: 6.2, z: 1.0 },
    { part: 'KitCrate', x: 6.2, z: 1.7 },
    { part: 'KitSign', x: 2.0, z: 4.86, y: 2.2, yaw: Math.PI },
    { part: 'KitPlanter', x: 6.3, z: 4.3 },
  ],
  points: [
    {
      id: 'grocery_counter',
      kind: 'counter',
      x: 5.0,
      y: 1.1,
      z: 3.9,
      radius: 1.8,
      prompt: 'Buy something',
      service: 'grocery_buy',
      priority: 25,
    },
    {
      id: 'grocery_shift',
      kind: 'desk',
      x: 6.2,
      y: 0.9,
      z: 3.4,
      radius: 1.4,
      prompt: 'Ask for a shift',
      task: 'job_grocery_shift',
    },
    { id: 'grocery_aisle_a', kind: 'shelf', x: 0.8, y: 1.0, z: 1.43, radius: 1.6, prompt: 'Stock the shelf' },
    { id: 'grocery_aisle_b', kind: 'shelf', x: 3.6, y: 1.0, z: 1.43, radius: 1.6, prompt: 'Stock the shelf' },
  ],
  workPoints: [
    { id: 'grocery_till', x: 5.0, z: 2.9, facing: 0, role: 'clerk' },
    { id: 'grocery_stock', x: 2.2, z: 1.43, facing: HALF_PI, role: 'stocker' },
  ],
  lights: [
    { x: 1.4, y: 2.7, z: 0.6, colour: 0xf6f0dc, power: 14 },
    { x: 4.6, y: 2.7, z: 2.4, colour: 0xf6f0dc, power: 14 },
  ],
};

// ---------------------------------------------------------------------------
// 3. Police station
// ---------------------------------------------------------------------------

const POLICE: InteriorDef = {
  id: 'police',
  name: 'Police station',
  service: 'police',
  floor: 'KitFloorScreed',
  cells: rect(3, 3),
  door: { x: 1, z: 2, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 2, z: 0, side: 'n' },
  ],
  // Cell (2,0) is fenced off by bars on two internal edges. A holding cell
  // without a second room, which is the whole argument for allowing bars on
  // an internal edge at all.
  bars: [
    { x: 2, z: 0, side: 's' },
    { x: 2, z: 0, side: 'w' },
  ],
  livePortal: false,
  audio: 'office',
  hours: SERVICE_HOURS.police,
  props: [
    { part: 'KitCounter', x: 2.0, z: 1.6 },
    { part: 'KitDesk', x: 0.2, z: 3.4, yaw: Math.PI },
    { part: 'KitChair', x: 0.2, z: 2.7 },
    { part: 'KitLocker', x: -0.55, z: 0.6, yaw: HALF_PI },
    { part: 'KitChair', x: 4.2, z: 0.4, yaw: Math.PI },
    { part: 'KitSign', x: 2.0, z: 4.86, y: 2.2, yaw: Math.PI },
    { part: 'KitPlanter', x: 4.4, z: 4.3 },
  ],
  points: [
    {
      id: 'police_desk',
      kind: 'counter',
      x: 2.0,
      y: 1.1,
      z: 2.2,
      radius: 1.8,
      prompt: 'Speak to the desk',
      service: 'police_desk',
      priority: 25,
    },
    {
      id: 'police_cell',
      kind: 'cell',
      x: 3.4,
      y: 1.2,
      z: 1.4,
      radius: 1.6,
      prompt: 'Look at the holding cell',
    },
  ],
  workPoints: [
    { id: 'police_front', x: 2.0, z: 1.1, facing: 0, role: 'desk_sergeant' },
    { id: 'police_office', x: 0.2, z: 2.7, facing: Math.PI, role: 'officer' },
  ],
  lights: [
    { x: 2.0, y: 2.7, z: 1.0, colour: 0xeef2f6, power: 13 },
    { x: 2.0, y: 2.7, z: 3.6, colour: 0xeef2f6, power: 11 },
  ],
};

// ---------------------------------------------------------------------------
// 4. Clinic
// ---------------------------------------------------------------------------

const CLINIC: InteriorDef = {
  id: 'clinic',
  name: 'Village clinic',
  service: 'clinic',
  floor: 'KitFloorTile',
  cells: rect(3, 2),
  door: { x: 1, z: 1, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 2, z: 0, side: 'n' },
  ],
  livePortal: false,
  audio: 'clinic',
  // No hours: somewhere to wake up after a bad fall has to be open when you
  // need it, and a closed clinic would make the recovery spawn a dead end.
  hours: SERVICE_HOURS.clinic,
  props: [
    // West of the entry spawn, not in front of it: the player lands at
    // (2, 2) and a counter centred on x = 2 would have them inside it.
    { part: 'KitCounter', x: 0.4, z: 1.6 },
    { part: 'KitClinicBed', x: 3.8, z: 0.2 },
    { part: 'KitShelf', x: 2.2, z: -0.55 },
    { part: 'KitPlanter', x: 4.4, z: 2.4 },
    { part: 'KitSign', x: 2.0, z: 2.86, y: 2.2, yaw: Math.PI },
  ],
  points: [
    {
      id: 'clinic_desk',
      kind: 'counter',
      x: 0.4,
      y: 1.1,
      z: 2.2,
      radius: 1.8,
      prompt: 'See the nurse',
      service: 'clinic_treat',
      priority: 25,
    },
    {
      id: 'clinic_bed',
      kind: 'bed',
      x: 3.8,
      y: 0.8,
      z: 0.2,
      radius: 1.6,
      prompt: 'Rest on the bed',
      priority: 30,
    },
  ],
  workPoints: [{ id: 'clinic_reception', x: 0.4, z: 1.1, facing: 0, role: 'nurse' }],
  lights: [
    { x: 2.0, y: 2.7, z: 0.4, colour: 0xf0f6f4, power: 14 },
    { x: 2.0, y: 2.7, z: 2.2, colour: 0xf0f6f4, power: 11 },
  ],
};

// ---------------------------------------------------------------------------
// 5. Garage and vehicle dealership
// ---------------------------------------------------------------------------

const GARAGE: InteriorDef = {
  id: 'garage',
  name: 'Garage and forecourt',
  service: 'garage',
  floor: 'KitFloorScreed',
  cells: rect(4, 3),
  door: { x: 1, z: 2, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 3, z: 1, side: 'e' },
  ],
  livePortal: false,
  audio: 'workshop',
  hours: SERVICE_HOURS.garage,
  props: [
    { part: 'KitCarLift', x: 4.4, z: 0.6 },
    { part: 'KitToolBench', x: 0.6, z: -0.5 },
    { part: 'KitCounter', x: 5.6, z: 3.4 },
    { part: 'KitTill', x: 5.6, z: 3.3, y: 1.01 },
    { part: 'KitShelf', x: -0.55, z: 0.9, yaw: HALF_PI },
    { part: 'KitCrate', x: -0.3, z: 2.2 },
    { part: 'KitCrate', x: -0.3, z: 3.0 },
    { part: 'KitLocker', x: 0.2, z: 4.3, yaw: Math.PI },
    { part: 'KitSign', x: 2.0, z: 4.86, y: 2.2, yaw: Math.PI },
  ],
  points: [
    {
      id: 'garage_desk',
      kind: 'counter',
      x: 5.6,
      y: 1.1,
      z: 3.9,
      radius: 1.8,
      prompt: 'Talk to the mechanic',
      service: 'garage_desk',
      priority: 25,
    },
    {
      id: 'garage_lift',
      kind: 'lift',
      x: 4.4,
      y: 0.9,
      z: 1.7,
      radius: 1.9,
      prompt: 'Work the lift',
      task: 'job_garage_recovery',
    },
    { id: 'garage_bench', kind: 'desk', x: 0.6, y: 0.9, z: 0.3, radius: 1.5, prompt: 'Use the workbench' },
  ],
  workPoints: [
    { id: 'garage_sales', x: 5.6, z: 2.9, facing: 0, role: 'sales' },
    { id: 'garage_bay', x: 3.0, z: 0.6, facing: -HALF_PI, role: 'mechanic' },
  ],
  lights: [
    { x: 1.4, y: 2.7, z: 0.6, colour: 0xf2efe2, power: 13 },
    { x: 4.6, y: 2.7, z: 2.6, colour: 0xf2efe2, power: 13 },
  ],
};

// ---------------------------------------------------------------------------
// 6. Starter apartment
// ---------------------------------------------------------------------------

const APARTMENT: InteriorDef = {
  id: 'apartment',
  name: 'Starter apartment',
  service: 'apartment',
  floor: 'KitFloor',
  cells: rect(2, 2),
  door: { x: 1, z: 1, side: 's' },
  windows: [{ x: 0, z: 0, side: 'n' }],
  // The second hero interior. The apartment is where a player spends their
  // evenings, so the window earns a live view the way the family home does.
  livePortal: true,
  audio: 'home',
  hours: SERVICE_HOURS.apartment,
  // Everything is kept off the entry lane — x in [1.6, 2.4] from the door at
  // (2, 3) up to the bed. The shower started life in the south-east corner,
  // where its glass side panel stood exactly where the player materialises.
  props: [
    { part: 'KitBed', x: 2.3, z: 0.2 },
    { part: 'KitWardrobe', x: 0.0, z: -0.55 },
    { part: 'KitDesk', x: -0.5, z: 0.4, yaw: HALF_PI },
    { part: 'KitChair', x: 0.4, z: 0.4, yaw: -HALF_PI },
    { part: 'KitShower', x: -0.4, z: 2.4 },
  ],
  decorSlots: [
    { id: 'apt_slot_a', x: 1.0, z: -0.5 },
    { id: 'apt_slot_b', x: -0.5, z: 1.6 },
    { id: 'apt_slot_c', x: 0.8, z: 2.6 },
  ],
  points: [
    { id: 'apt_bed', kind: 'bed', x: 2.3, y: 0.7, z: 0.2, radius: 1.6, prompt: 'Sleep', priority: 30 },
    { id: 'apt_wardrobe', kind: 'wardrobe', x: 0.0, z: -0.55, y: 1.05, radius: 1.4, prompt: 'Open the wardrobe' },
    { id: 'apt_shower', kind: 'shower', x: -0.4, z: 2.4, y: 1.0, radius: 1.4, prompt: 'Take a shower' },
    { id: 'apt_desk', kind: 'save', x: -0.5, z: 0.4, y: 0.8, radius: 1.4, prompt: 'Write the day down', service: 'apartment_save' },
    { id: 'apt_decorate', kind: 'decorate', x: 0.8, z: 2.0, y: 0.9, radius: 1.3, prompt: 'Decorate', service: 'apartment_decorate' },
  ],
  workPoints: [],
  /**
   * Two lights, like every other interior — and the second one is not for the
   * look of the room.
   *
   * three.js puts the scene's point-light *count* in its program cache key, so
   * a room lit differently from the other eight forces every material in the
   * scene to compile a second time. Measured: the apartment alone took the
   * session from 53 programs to 69, against a budget of 70. One extra light
   * costs a draw of nothing and keeps all nine on one lighting configuration.
   */
  lights: [
    { x: 1.0, y: 2.6, z: 0.8, colour: 0xffe0ad, power: 12 },
    { x: 1.4, y: 1.1, z: 2.2, colour: 0xffd39a, power: 4.5 },
  ],
};

// ---------------------------------------------------------------------------
// 7. Cafe
// ---------------------------------------------------------------------------

const CAFE: InteriorDef = {
  id: 'cafe',
  name: 'Corner cafe',
  service: 'cafe',
  floor: 'KitFloor',
  cells: rect(3, 2),
  door: { x: 1, z: 1, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 2, z: 0, side: 'n' },
  ],
  livePortal: false,
  audio: 'cafe',
  hours: SERVICE_HOURS.cafe,
  props: [
    { part: 'KitCounter', x: 0.4, z: -0.5 },
    { part: 'KitCoffeeBar', x: 0.4, z: -0.6, y: 1.01 },
    { part: 'KitTable', x: 3.2, z: 0.2 },
    { part: 'KitStool', x: 2.6, z: 0.2 },
    { part: 'KitStool', x: 3.8, z: 0.2 },
    // Pushed east of the entry lane. At x = 2.6 the near stool sat 0.1 m
    // inside the spawn clearance circle — you walked in already stuck on it.
    { part: 'KitTable', x: 3.4, z: 2.2 },
    { part: 'KitStool', x: 2.9, z: 2.2 },
    { part: 'KitStool', x: 3.9, z: 2.2 },
    { part: 'KitPlanter', x: 4.4, z: -0.5 },
    { part: 'KitSign', x: 2.0, z: 2.86, y: 2.2, yaw: Math.PI },
  ],
  points: [
    {
      id: 'cafe_counter',
      kind: 'counter',
      x: 0.4,
      y: 1.1,
      z: 0.1,
      radius: 1.7,
      prompt: 'Order something',
      service: 'cafe_order',
      priority: 25,
    },
    { id: 'cafe_seat_a', kind: 'chair', x: 2.6, y: 0.5, z: 0.2, radius: 1.1, prompt: 'Take a seat', facing: HALF_PI },
    { id: 'cafe_seat_b', kind: 'chair', x: 2.9, y: 0.5, z: 2.2, radius: 1.1, prompt: 'Take a seat', facing: HALF_PI },
  ],
  workPoints: [{ id: 'cafe_bar', x: 0.4, z: -0.9, facing: 0, role: 'barista' }],
  lights: [
    { x: 1.2, y: 2.6, z: 0.2, colour: 0xffdcae, power: 12 },
    { x: 3.4, y: 2.6, z: 1.2, colour: 0xffdcae, power: 11 },
  ],
};

// ---------------------------------------------------------------------------
// 8. Clothing shop
// ---------------------------------------------------------------------------

const CLOTHING: InteriorDef = {
  id: 'clothing',
  name: 'Clothing shop',
  service: 'clothing',
  floor: 'KitFloorTile',
  cells: rect(3, 2),
  door: { x: 1, z: 1, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 2, z: 0, side: 'n' },
  ],
  livePortal: false,
  audio: 'shop',
  hours: SERVICE_HOURS.clothing,
  props: [
    { part: 'KitCounter', x: 3.6, z: 1.6 },
    { part: 'KitTill', x: 3.6, z: 1.5, y: 1.01 },
    { part: 'KitClothingRack', x: 0.0, z: -0.4 },
    { part: 'KitClothingRack', x: 0.0, z: 1.2 },
    { part: 'KitClothingRack', x: 2.0, z: -0.4 },
    { part: 'KitShelf', x: -0.55, z: 2.0, yaw: HALF_PI },
    { part: 'KitPlanter', x: 4.4, z: 2.4 },
    { part: 'KitSign', x: 2.0, z: 2.86, y: 2.2, yaw: Math.PI },
  ],
  points: [
    {
      id: 'clothing_counter',
      kind: 'counter',
      x: 3.6,
      y: 1.1,
      z: 2.2,
      radius: 1.7,
      prompt: 'Buy clothes',
      service: 'clothing_buy',
      priority: 25,
    },
    {
      id: 'clothing_rack',
      kind: 'rack',
      x: 0.0,
      y: 1.0,
      z: 1.2,
      radius: 1.5,
      prompt: 'Try something on',
      service: 'clothing_try',
    },
  ],
  workPoints: [{ id: 'clothing_till', x: 3.6, z: 1.1, facing: 0, role: 'clerk' }],
  lights: [
    { x: 1.0, y: 2.6, z: 0.2, colour: 0xf8f2e4, power: 13 },
    { x: 3.4, y: 2.6, z: 1.4, colour: 0xf8f2e4, power: 11 },
  ],
};

// ---------------------------------------------------------------------------
// 9. Airstrip office and hangar shell
// ---------------------------------------------------------------------------

const AIRSTRIP: InteriorDef = {
  id: 'airstrip',
  name: 'Airstrip office',
  service: 'airstrip',
  floor: 'KitFloorScreed',
  cells: rect(4, 3),
  door: { x: 1, z: 2, side: 's' },
  windows: [
    { x: 0, z: 0, side: 'n' },
    { x: 3, z: 0, side: 'n' },
    { x: 3, z: 1, side: 'e' },
  ],
  livePortal: false,
  audio: 'hangar',
  hours: SERVICE_HOURS.airstrip,
  // Deliberately sparse. This is a shell for the aircraft phase, and filling
  // it now would mean deleting furniture later to make room for an aeroplane.
  props: [
    { part: 'KitFlightDesk', x: 0.6, z: 1.6 },
    { part: 'KitChair', x: 0.6, z: 2.6, yaw: Math.PI },
    { part: 'KitLocker', x: -0.55, z: 0.2, yaw: HALF_PI },
    { part: 'KitToolBench', x: 4.6, z: -0.5 },
    { part: 'KitCrate', x: 6.2, z: 0.6 },
    { part: 'KitCrate', x: 6.2, z: 1.4 },
    { part: 'KitCrate', x: 5.4, z: 0.6 },
    { part: 'KitSign', x: 2.0, z: 4.86, y: 2.2, yaw: Math.PI },
  ],
  points: [
    {
      id: 'airstrip_desk',
      kind: 'desk',
      x: 0.6,
      y: 1.0,
      z: 2.3,
      radius: 1.7,
      prompt: 'Check the flight log',
      service: 'airstrip_log',
      priority: 25,
    },
    { id: 'airstrip_bay', kind: 'lift', x: 3.4, y: 1.0, z: 2.6, radius: 2.0, prompt: 'Look over the empty bay' },
  ],
  workPoints: [{ id: 'airstrip_radio', x: 0.6, z: 1.1, facing: 0, role: 'controller' }],
  lights: [
    { x: 1.4, y: 2.8, z: 1.0, colour: 0xeef0ee, power: 13 },
    { x: 4.6, y: 2.8, z: 2.4, colour: 0xeef0ee, power: 13 },
  ],
};

export const INTERIORS: readonly InteriorDef[] = [
  HOME,
  GROCERY,
  POLICE,
  CLINIC,
  GARAGE,
  APARTMENT,
  CAFE,
  CLOTHING,
  AIRSTRIP,
];

const BY_ID = new Map(INTERIORS.map((d) => [d.id, d]));

export function interiorDef(id: string): InteriorDef | null {
  return BY_ID.get(id) ?? null;
}
