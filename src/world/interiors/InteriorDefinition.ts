/**
 * What an enterable building *is*, as data.
 *
 * One `InteriorDef` per service. The layout is a set of grid cells plus a list
 * of props; the walls are **derived** from the cells rather than authored,
 * because a hand-written wall list is a list of chances to leave a gap. A def
 * names the one edge its front door is on, marks a few edges as windows, and
 * everything else on the perimeter becomes solid wall.
 *
 * Nothing here is engine-aware. `InteriorBuilder` turns one of these into
 * meshes and colliders; `interiorCatalog.ts` holds the nine.
 */

import {
  MODULE,
  OPPOSITE,
  SIDES,
  SIDE_STEP,
  blocksStanding,
  cellCentre,
  circleHitsBox,
  edgeTransform,
  placeBoxes,
  type FloorPart,
  type KitPart,
  type Side,
  type WallPart,
} from './InteriorKit';

/**
 * How much room the entry spawn needs, in plan.
 *
 * The player capsule is 0.30 m; this is deliberately half again as much, so a
 * layout passes only if there is somewhere to *stand*, not merely somewhere
 * the capsule technically fits.
 */
export const SPAWN_CLEARANCE = 0.45;

/** The nine required service types, and nothing else. */
export type ServiceType =
  | 'home'
  | 'grocery'
  | 'police'
  | 'clinic'
  | 'garage'
  | 'apartment'
  | 'cafe'
  | 'clothing'
  | 'airstrip';

export const SERVICE_TYPES: readonly ServiceType[] = [
  'home',
  'grocery',
  'police',
  'clinic',
  'garage',
  'apartment',
  'cafe',
  'clothing',
  'airstrip',
];

/**
 * Which ambient bed and reverb an interior uses.
 *
 * A profile rather than a file per building: nine rooms do not need nine
 * loops, and `AudioManager` already knows how to cross-fade a named zone.
 */
export type InteriorAudioProfile =
  | 'home'
  | 'shop'
  | 'office'
  | 'clinic'
  | 'workshop'
  | 'cafe'
  | 'hangar';

/** Integer grid coordinates. Cell (0,0) is the room's origin module. */
export interface Cell {
  readonly x: number;
  readonly z: number;
}

export interface EdgeRef extends Cell {
  readonly side: Side;
}

/** A placed prop, in room-local metres with the floor at y = 0. */
export interface PropPlacement {
  readonly part: KitPart;
  readonly x: number;
  readonly z: number;
  /** Off the floor — a till on a counter, a sign on a wall. */
  readonly y?: number;
  readonly yaw?: number;
}

/**
 * Something the player can walk up to and press interact on, inside.
 *
 * `service` names an offer in the building's service menu; a point with no
 * service is a physical interaction (a bed, a chair, a shower) that the game
 * handles directly.
 */
export interface InteriorPoint {
  readonly id: string;
  readonly kind: InteriorPointKind;
  readonly x: number;
  readonly y: number;
  readonly z: number;
  readonly radius: number;
  readonly prompt: string;
  readonly service?: string;
  /** Task id this point starts, for the job loops. */
  readonly task?: string;
  /**
   * Which way to face when using it. Seats only.
   *
   * glTF convention, matching `PlayerController.facing`. Standing up steps
   * 0.9 m back along the opposite of this, which is why a seat that faces
   * nowhere in particular should leave it out rather than guess.
   */
  readonly facing?: number;
  /** Higher wins when two points overlap. Defaults to 20. */
  readonly priority?: number;
}

export type InteriorPointKind =
  | 'counter'
  | 'shelf'
  | 'bed'
  | 'chair'
  | 'wardrobe'
  | 'shower'
  | 'desk'
  | 'lift'
  | 'rack'
  | 'cell'
  | 'decorate'
  | 'save'
  | 'fish';

export interface DecorSlot {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly yaw?: number;
}

/** Where an NPC stands to work. Consumed by `Population` in the next phase. */
export interface WorkPoint {
  readonly id: string;
  readonly x: number;
  readonly z: number;
  readonly facing: number;
  readonly role: string;
}

/**
 * When the doors are unlocked.
 *
 * `open` and `close` are hours in [0, 24). A `close` at or before `open` wraps
 * past midnight, which is how the night-shift schedule in Phase 6 already
 * reads its blocks — same trick, same reason: no special case for midnight.
 * `null` means always open.
 */
export interface OpeningHours {
  readonly open: number;
  readonly close: number;
}

/**
 * When each kind of place is open, kept out here rather than inside the
 * layouts.
 *
 * Opening hours belong to the *service*, not to the room: the sign on the
 * door has to say "closed until 07:00" before anything has decided what the
 * inside looks like. Keeping this in the eager half means a shut shop costs
 * nothing to bounce off — the 26 kB interior subsystem is never fetched.
 *
 * `null` is round-the-clock. Somewhere to sleep and somewhere to be treated
 * have to be open when you need them, and a station with office hours is not
 * a police station.
 */
export const SERVICE_HOURS: Readonly<Record<ServiceType, OpeningHours | null>> = {
  home: null,
  apartment: null,
  clinic: null,
  police: null,
  grocery: { open: 7, close: 21 },
  cafe: { open: 6, close: 22 },
  clothing: { open: 9, close: 20 },
  garage: { open: 8, close: 19 },
  airstrip: { open: 6, close: 20 },
};

export interface InteriorDef {
  readonly id: string;
  readonly name: string;
  readonly service: ServiceType;
  readonly floor: FloorPart;
  readonly cells: readonly Cell[];
  /** The one edge the front door is on. Must be on the perimeter. */
  readonly door: EdgeRef;
  readonly windows?: readonly EdgeRef[];
  /** Interior edges that get bars rather than nothing — the holding cell. */
  readonly bars?: readonly EdgeRef[];
  readonly props: readonly PropPlacement[];
  readonly points: readonly InteriorPoint[];
  readonly workPoints: readonly WorkPoint[];
  /**
   * Places a bought decoration can stand.
   *
   * Empty until the player buys something. The slot holds an item id and the
   * builder looks up which kit part that item paints in, so decorating adds no
   * geometry the kit does not already have.
   */
  readonly decorSlots?: readonly DecorSlot[];
  readonly audio: InteriorAudioProfile;
  readonly hours: OpeningHours | null;
  /**
   * Whether the windows render the live outdoor world.
   *
   * Expensive: a portal pass re-renders the whole outdoor scene, which is what
   * takes the interior from ~482 k triangles to ~780 k. Two interiors have it;
   * the rest get an ordinary toon pane. See `docs/PERFORMANCE_BUDGETS.md`.
   */
  readonly livePortal: boolean;
  /** Warm practicals, room-local. */
  readonly lights: readonly { x: number; y: number; z: number; colour: number; power: number }[];
}

// ---------------------------------------------------------------------------
// Derived geometry
// ---------------------------------------------------------------------------

const key = (x: number, z: number): string => `${x},${z}`;
const edgeKey = (e: EdgeRef): string => `${e.x},${e.z},${e.side}`;

/**
 * Canonical name for an edge, so the same wall seen from either of the two
 * cells it separates compares equal. Without this a shared internal edge is
 * counted twice and the perimeter test lets it through.
 */
export function canonicalEdge(e: EdgeRef): string {
  const [sx, sz] = SIDE_STEP[e.side];
  const nx = e.x + sx;
  const nz = e.z + sz;
  // Order the two cells so either view produces the same string.
  return e.x < nx || (e.x === nx && e.z < nz)
    ? `${e.x},${e.z}|${e.side}`
    : `${nx},${nz}|${OPPOSITE[e.side]}`;
}

export interface WallRun {
  readonly cell: Cell;
  readonly side: Side;
  readonly part: WallPart;
  readonly x: number;
  readonly z: number;
  readonly yaw: number;
}

/**
 * Every wall segment the room needs.
 *
 * A perimeter edge is one whose neighbouring cell is not part of the room.
 * The door edge becomes `KitWallDoor`, listed windows become
 * `KitWallWindow`, everything else `KitWall`. Bars are the one thing allowed
 * on an *internal* edge, which is what makes a holding cell possible without
 * a second room.
 */
export function wallRuns(def: InteriorDef): WallRun[] {
  const occupied = new Set(def.cells.map((c) => key(c.x, c.z)));
  const windows = new Set((def.windows ?? []).map(canonicalEdge));
  const doorKey = canonicalEdge(def.door);
  const out: WallRun[] = [];
  const seen = new Set<string>();

  for (const c of def.cells) {
    for (const side of SIDES) {
      const [sx, sz] = SIDE_STEP[side];
      if (occupied.has(key(c.x + sx, c.z + sz))) continue;

      const e: EdgeRef = { x: c.x, z: c.z, side };
      const ck = canonicalEdge(e);
      if (seen.has(ck)) continue;
      seen.add(ck);

      const part: WallPart =
        ck === doorKey ? 'KitWallDoor' : windows.has(ck) ? 'KitWallWindow' : 'KitWall';
      const t = edgeTransform(c.x, c.z, side);
      out.push({ cell: { x: c.x, z: c.z }, side, part, x: t.x, z: t.z, yaw: t.yaw });
    }
  }

  for (const b of def.bars ?? []) {
    const t = edgeTransform(b.x, b.z, b.side);
    out.push({ cell: { x: b.x, z: b.z }, side: b.side, part: 'KitCellBars', ...t });
  }

  // Stable order so a rebuild produces the same scene graph, which is what
  // makes a draw-call measurement repeatable.
  out.sort((a, b) => a.x - b.x || a.z - b.z || (a.side < b.side ? -1 : 1));
  return out;
}

/**
 * Where the player lands on entering, and which way they look.
 *
 * Derived from the door rather than authored: a hand-placed spawn is a spawn
 * that can be left inside a wardrobe when the layout moves. One metre inside
 * the threshold along the inward normal puts the character clear of the door
 * swing and of the doorway's own collider.
 */
export function entrySpawn(def: InteriorDef): { x: number; z: number; facing: number } {
  const t = edgeTransform(def.door.x, def.door.z, def.door.side);
  const [ix, iz] = t.inward;
  return {
    x: t.x + ix * 1.0,
    z: t.z + iz * 1.0,
    // glTF convention, matching PlayerController.facing.
    facing: Math.atan2(ix, iz),
  };
}

/** Where the "leave" prompt sits: in the doorway itself. */
export function exitPoint(def: InteriorDef): { x: number; y: number; z: number } {
  const t = edgeTransform(def.door.x, def.door.z, def.door.side);
  const [ix, iz] = t.inward;
  return { x: t.x + ix * 0.45, y: 1.0, z: t.z + iz * 0.45 };
}

// ---------------------------------------------------------------------------
// Hours
// ---------------------------------------------------------------------------

/**
 * Is this place open at `hour`?
 *
 * Wrapping is handled by comparison rather than by a branch: a range whose
 * close is at or before its open is a range that spans midnight, so the test
 * flips from "inside both bounds" to "outside neither".
 */
export function isOpenAt(hours: OpeningHours | null, hour: number): boolean {
  if (hours === null) return true;
  const h = ((hour % 24) + 24) % 24;
  const { open, close } = hours;
  if (open === close) return true; // a degenerate range means always
  return close > open ? h >= open && h < close : h >= open || h < close;
}

/** "08:00", for a closed-door message. */
export function formatHour(hour: number): string {
  const h = ((Math.floor(hour) % 24) + 24) % 24;
  const m = Math.round((hour - Math.floor(hour)) * 60);
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export interface InteriorValidation {
  readonly ok: boolean;
  readonly errors: readonly string[];
}

/**
 * Catch layout mistakes at test time rather than by walking into them.
 *
 * The expensive ones to find by hand are a door on an internal edge (you enter
 * facing a wall) and a prop standing outside the floor (you interact with
 * something floating in the void), so both are checked explicitly.
 */
export function validateInterior(def: InteriorDef): InteriorValidation {
  const errors: string[] = [];
  const occupied = new Set(def.cells.map((c) => key(c.x, c.z)));

  if (def.cells.length === 0) errors.push(`${def.id}: has no cells`);
  if (occupied.size !== def.cells.length) errors.push(`${def.id}: duplicate cells`);

  const isPerimeter = (e: EdgeRef): boolean => {
    if (!occupied.has(key(e.x, e.z))) return false;
    const [sx, sz] = SIDE_STEP[e.side];
    return !occupied.has(key(e.x + sx, e.z + sz));
  };

  if (!isPerimeter(def.door)) {
    errors.push(`${def.id}: door ${edgeKey(def.door)} is not on the perimeter`);
  }
  for (const w of def.windows ?? []) {
    if (!isPerimeter(w)) errors.push(`${def.id}: window ${edgeKey(w)} is not on the perimeter`);
    if (canonicalEdge(w) === canonicalEdge(def.door)) {
      errors.push(`${def.id}: window ${edgeKey(w)} is also the door`);
    }
  }
  for (const b of def.bars ?? []) {
    if (!occupied.has(key(b.x, b.z))) errors.push(`${def.id}: bars ${edgeKey(b)} are outside`);
  }

  // Props and interaction points must stand on a floor tile. Half a module of
  // tolerance so something flush against a wall still passes.
  const onFloor = (x: number, z: number): boolean => {
    for (const c of def.cells) {
      const p = cellCentre(c.x, c.z);
      if (Math.abs(x - p.x) <= MODULE / 2 + 0.01 && Math.abs(z - p.z) <= MODULE / 2 + 0.01) {
        return true;
      }
    }
    return false;
  };

  for (const p of def.props) {
    if (!onFloor(p.x, p.z)) errors.push(`${def.id}: prop ${p.part} at ${p.x},${p.z} is off the floor`);
  }
  for (const p of def.points) {
    if (!onFloor(p.x, p.z)) errors.push(`${def.id}: point ${p.id} at ${p.x},${p.z} is off the floor`);
  }
  for (const w of def.workPoints) {
    if (!onFloor(w.x, w.z)) errors.push(`${def.id}: work point ${w.id} is off the floor`);
  }
  for (const s of def.decorSlots ?? []) {
    if (!onFloor(s.x, s.z)) errors.push(`${def.id}: decor slot ${s.id} is off the floor`);
  }

  const ids = new Set<string>();
  for (const p of def.points) {
    if (ids.has(p.id)) errors.push(`${def.id}: duplicate point id ${p.id}`);
    ids.add(p.id);
  }

  const spawn = entrySpawn(def);
  if (!onFloor(spawn.x, spawn.z)) errors.push(`${def.id}: entry spawn is off the floor`);

  // "Safe entry spawn" as an assertion rather than a hope. This is the check
  // that found the apartment shower: its glass side panel, yawed a half turn,
  // landed exactly where the player materialises — invisible in the numbers,
  // obvious the moment you walk in and cannot move.
  for (const p of def.props) {
    for (const box of placeBoxes(p.part, p.x, p.y ?? 0, p.z, p.yaw ?? 0)) {
      if (blocksStanding(box) && circleHitsBox(box, spawn.x, spawn.z, SPAWN_CLEARANCE)) {
        errors.push(`${def.id}: prop ${p.part} at ${p.x},${p.z} blocks the entry spawn`);
      }
    }
  }

  if (def.hours && (def.hours.open < 0 || def.hours.open >= 24)) {
    errors.push(`${def.id}: opening hour out of range`);
  }
  if (def.hours && (def.hours.close < 0 || def.hours.close >= 24)) {
    errors.push(`${def.id}: closing hour out of range`);
  }

  return { ok: errors.length === 0, errors };
}
