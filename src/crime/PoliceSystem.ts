import type { Vec3Like } from '../nav/NavTypes';
import type { HeatBelief } from './Heat';

/**
 * What the police do about it.
 *
 * **The structural half of acceptance criterion 2 lives in `PoliceWorld`.**
 * An officer is never handed the player's position. The only way to learn it
 * is `sees(officerId)`, which the host answers from the same perception layer
 * everybody else uses — so an officer round a corner gets `null` and has
 * nothing to chase. Everything else navigates to `belief.at`, which is where
 * the police *think* the player is and is often wrong.
 *
 * That is why this file has no `playerPosition` parameter anywhere. If one
 * ever appears, the criterion is gone and the diff will say so plainly.
 *
 * Pure and clockless: seconds arrive through `update(dt)`, positions arrive
 * through the host, and nothing here touches a scene or a navmesh.
 */

export type OfficerState =
  /** Not involved. Walking a beat. */
  | 'patrol'
  /** Heading to where the report said. Has not seen anybody yet. */
  | 'investigate'
  /** Can see the player and is closing the distance. */
  | 'approach'
  /** In talking range, giving them the chance to stop. */
  | 'warn'
  /** They ran. */
  | 'pursue'
  /** They drove. */
  | 'pursue_vehicle'
  /** Lost them; sweeping the last place they were seen. */
  | 'search'
  /** In contact and taking them in. */
  | 'arrest'
  /** Giving up and going back to the beat. */
  | 'disengage';

export interface OfficerSnapshot {
  readonly id: string;
  readonly state: OfficerState;
  readonly at: Vec3Like;
  /** Seconds spent in the current state. */
  readonly stateSeconds: number;
  /** Where this officer is currently heading, or null when nowhere. */
  readonly goal: Vec3Like | null;
  readonly inVehicle: boolean;
}

/** What an officer needs from the world, and deliberately nothing more. */
export interface PoliceWorld {
  /** Where the police believe the player is. Null when they have nothing. */
  readonly belief: HeatBelief | null;
  readonly heat: number;

  /**
   * Can this officer perceive the player *right now*?
   *
   * The single source of the player's position in this whole system. The host
   * answers it from `Perception`, with the same distance, field of view and
   * occlusion every NPC uses — so an officer facing a wall is as blind as a
   * shopkeeper facing a wall.
   */
  sees(officerId: string): { readonly at: Vec3Like; readonly distance: number } | null;

  positionOf(officerId: string): Vec3Like;
  /** Move an officer toward a point at a speed. The host owns pathing. */
  moveTo(officerId: string, to: Vec3Like, speed: number): void;
  /** Stand still. */
  halt(officerId: string): void;
  /** Whether the player is currently driving, which decides the pursuit kind. */
  readonly playerDriving: boolean;
  /** Whether this officer has a car available. */
  hasVehicle(officerId: string): boolean;

  /** Say something. The host turns it into a toast or a bark. */
  say(officerId: string, line: PoliceLine): void;
  /** The host does the arrest: fade, fine, move the player, advance time. */
  arrest(officerId: string): void;
  /** Path failed. The host reports it so the unit can recover. */
  pathFailed(officerId: string): boolean;
}

export type PoliceLine = 'halt' | 'warn' | 'fine' | 'surrender' | 'lost' | 'stand_down';

// ---------------------------------------------------------------------------
// Tuning
// ---------------------------------------------------------------------------

/** Close enough to talk. */
export const WARN_RANGE = 4.5;
/** Close enough to put hands on. */
export const ARREST_RANGE = 2.2;
/** Seconds of warning before the officer stops asking. */
export const WARN_SECONDS = 3.5;
/** Seconds of not seeing anybody before a pursuit becomes a search. */
export const LOSE_SIGHT_SECONDS = 4;
/** Seconds of fruitless searching before an officer gives up. */
export const SEARCH_SECONDS = 18;
/** How far from the last known point an officer will sweep. */
export const SEARCH_RADIUS = 14;
/**
 * Seconds after which a belief is too old to be worth walking to.
 *
 * Mirrors `HeatSystem.BELIEF_STALE_SECONDS` deliberately — the two systems
 * have to agree about when a trail is cold, or officers keep investigating
 * reports the Heat system has already written off.
 */
export const BELIEF_STALE_SECONDS = 22;

export const WALK_SPEED = 1.5;
export const RUN_SPEED = 4.4;
export const DRIVE_SPEED = 12;

/**
 * Officers on duty at each Heat level, and whether they may use cars.
 *
 * The counts are a performance budget as much as a design one. Phase 6
 * measured a pedestrian at one draw call and 4,890 triangles, and the outdoor
 * budget has roughly 60 draw calls of headroom at the `high` preset — so five
 * officers plus two patrol cars is the ceiling, and level 5 sits on it.
 */
export interface HeatTier {
  readonly officers: number;
  readonly vehicles: number;
  readonly roadblocks: number;
}

export const HEAT_TIERS: readonly HeatTier[] = [
  { officers: 0, vehicles: 0, roadblocks: 0 }, // 0 — nothing
  { officers: 1, vehicles: 0, roadblocks: 0 }, // 1 — somebody has a word
  { officers: 2, vehicles: 0, roadblocks: 0 }, // 2 — two on foot
  { officers: 2, vehicles: 1, roadblocks: 0 }, // 3 — a car joins
  { officers: 3, vehicles: 1, roadblocks: 1 }, // 4 — one junction blocked
  { officers: 3, vehicles: 2, roadblocks: 2 }, // 5 — as much as the budget allows
];

export function tierFor(heat: number): HeatTier {
  const i = Math.max(0, Math.min(HEAT_TIERS.length - 1, Math.ceil(heat)));
  return HEAT_TIERS[i];
}

// ---------------------------------------------------------------------------
// One officer
// ---------------------------------------------------------------------------

/**
 * A single officer's state machine.
 *
 * Deliberately small and deliberately forgetful. Its only memory is the last
 * place it *itself* saw the player; everything else it re-reads from the
 * world each tick, so it cannot accumulate knowledge nobody gave it.
 */
export class PoliceUnit {
  state: OfficerState = 'patrol';
  stateSeconds = 0;
  /** The last place this officer personally saw them. Not the shared belief. */
  private ownSighting: Vec3Like | null = null;
  private sinceSeen = 0;
  private searchAnchor: Vec3Like | null = null;
  private searchAngle = 0;
  private goalValue: Vec3Like | null = null;
  /** Rolling count, for the debug overlay and for tests. */
  pathFailures = 0;

  constructor(readonly id: string) {}

  get goal(): Vec3Like | null {
    return this.goalValue;
  }

  snapshot(world: PoliceWorld): OfficerSnapshot {
    return {
      id: this.id,
      state: this.state,
      at: world.positionOf(this.id),
      stateSeconds: this.stateSeconds,
      goal: this.goalValue,
      inVehicle: this.state === 'pursue_vehicle',
    };
  }

  private to(next: OfficerState): void {
    if (this.state === next) return;
    this.state = next;
    this.stateSeconds = 0;
  }

  /**
   * One tick.
   *
   * Order matters: **look first, then decide.** Every state re-asks whether it
   * can see the player before acting, so no state can act on a sighting that
   * has expired.
   */
  update(dt: number, world: PoliceWorld): void {
    this.stateSeconds += dt;

    const seen = world.sees(this.id);
    if (seen) {
      this.ownSighting = { ...seen.at };
      this.sinceSeen = 0;
    } else {
      this.sinceSeen += dt;
    }

    // Nothing to do, whatever state we were in.
    if (world.heat <= 0) {
      if (this.state !== 'patrol') {
        world.say(this.id, 'stand_down');
        this.reset(world);
      }
      return;
    }

    // A failed path is recovered by falling back to a search around wherever
    // we are, rather than by standing still forever waiting for a route.
    if (world.pathFailed(this.id)) {
      this.pathFailures++;
      this.searchAnchor = { ...world.positionOf(this.id) };
      this.to('search');
    }

    switch (this.state) {
      case 'patrol':
      case 'disengage':
        this.doInvestigateOrIdle(dt, world, seen);
        break;

      case 'investigate':
        this.doInvestigate(dt, world, seen);
        break;

      case 'approach':
        this.doApproach(world, seen);
        break;

      case 'warn':
        this.doWarn(world, seen);
        break;

      case 'pursue':
      case 'pursue_vehicle':
        this.doPursue(world, seen);
        break;

      case 'search':
        this.doSearch(dt, world, seen);
        break;

      case 'arrest':
        // The host owns what an arrest does; the unit just holds still.
        world.halt(this.id);
        break;
    }
  }

  /**
   * Idle, and deciding whether there is anything to do.
   *
   * Delegates immediately after transitioning rather than waiting for the next
   * tick. At 1/60 s the difference is invisible, but a state machine where
   * entering a state does nothing until the following frame is one where every
   * test has to tick twice to see anything, and that is how a real
   * responsiveness bug hides.
   *
   * A **stale** belief is not worth walking to. Without that check an officer
   * who searched a place and gave up immediately turns round and investigates
   * the same cold report again, forever — which is what the first run of
   * `police.test.ts` found.
   */
  private doInvestigateOrIdle(
    dt: number,
    world: PoliceWorld,
    seen: ReturnType<PoliceWorld['sees']>,
  ): void {
    if (seen) {
      this.to('approach');
      this.doApproach(world, seen);
      return;
    }
    if (world.belief && world.belief.age < BELIEF_STALE_SECONDS) {
      this.to('investigate');
      this.doInvestigate(dt, world, seen);
    }
  }

  /** Walking to where the report said. Nobody has been seen yet. */
  private doInvestigate(dt: number, world: PoliceWorld, seen: ReturnType<PoliceWorld['sees']>): void {
    void dt;
    if (seen) {
      world.say(this.id, 'halt');
      this.to('approach');
      return;
    }

    const belief = world.belief;
    if (!belief) {
      // The trail went cold on the way over. Sweep where we are and go home.
      this.searchAnchor = { ...world.positionOf(this.id) };
      this.to('search');
      return;
    }

    this.goalValue = belief.at;
    world.moveTo(this.id, belief.at, RUN_SPEED);

    // Arrived and nobody is here: start looking around rather than standing on
    // the spot the report named.
    if (distance(world.positionOf(this.id), belief.at) < 2.5) {
      this.searchAnchor = { ...belief.at };
      this.to('search');
    }
  }

  /** Seen them; closing the distance to talk. */
  private doApproach(world: PoliceWorld, seen: ReturnType<PoliceWorld['sees']>): void {
    if (!seen) {
      if (this.sinceSeen >= LOSE_SIGHT_SECONDS) {
        this.searchAnchor = this.ownSighting ? { ...this.ownSighting } : { ...world.positionOf(this.id) };
        world.say(this.id, 'lost');
        this.to('search');
      }
      return;
    }

    this.goalValue = seen.at;
    world.moveTo(this.id, seen.at, RUN_SPEED);

    if (seen.distance <= WARN_RANGE) {
      world.say(this.id, 'warn');
      this.to('warn');
    }
  }

  /**
   * Giving them the chance to stop.
   *
   * The player's non-lethal route runs through here: standing still while an
   * officer warns you ends in an arrest and a fine, not a fight. Walking away
   * turns it into a pursuit. That choice is the whole encounter.
   */
  private doWarn(world: PoliceWorld, seen: ReturnType<PoliceWorld['sees']>): void {
    if (!seen) {
      if (this.sinceSeen >= LOSE_SIGHT_SECONDS) {
        this.searchAnchor = this.ownSighting ? { ...this.ownSighting } : null;
        this.to('search');
      }
      return;
    }

    world.halt(this.id);
    this.goalValue = null;

    // Somebody sitting in a running car has not surrendered, however close the
    // officer is standing. Without this an officer reaches through the window
    // and arrests a driver mid-getaway, which a test caught immediately.
    if (world.playerDriving) {
      this.beginPursuit(world);
      return;
    }

    if (seen.distance <= ARREST_RANGE) {
      world.say(this.id, 'surrender');
      world.arrest(this.id);
      this.to('arrest');
      return;
    }

    // They did not stay. Chase, by whatever means they left by.
    if (this.stateSeconds >= WARN_SECONDS || seen.distance > WARN_RANGE * 1.6) {
      this.beginPursuit(world);
    }
  }

  private beginPursuit(world: PoliceWorld): void {
    const wantsCar = world.playerDriving && world.hasVehicle(this.id);
    this.to(wantsCar ? 'pursue_vehicle' : 'pursue');
    world.say(this.id, 'halt');
  }

  private doPursue(world: PoliceWorld, seen: ReturnType<PoliceWorld['sees']>): void {
    if (!seen) {
      if (this.sinceSeen >= LOSE_SIGHT_SECONDS) {
        this.searchAnchor = this.ownSighting ? { ...this.ownSighting } : { ...world.positionOf(this.id) };
        world.say(this.id, 'lost');
        this.to('search');
      } else if (this.ownSighting) {
        // Keep running to where they last were. This is the only "memory" an
        // officer has, and it is four seconds long.
        this.goalValue = this.ownSighting;
        world.moveTo(this.id, this.ownSighting, this.state === 'pursue_vehicle' ? DRIVE_SPEED : RUN_SPEED);
      }
      return;
    }

    // Switch between foot and car as the player does.
    const wantsCar = world.playerDriving && world.hasVehicle(this.id);
    this.to(wantsCar ? 'pursue_vehicle' : 'pursue');

    this.goalValue = seen.at;
    world.moveTo(this.id, seen.at, this.state === 'pursue_vehicle' ? DRIVE_SPEED : RUN_SPEED);

    if (seen.distance <= ARREST_RANGE && !world.playerDriving) {
      world.arrest(this.id);
      this.to('arrest');
    }
  }

  /**
   * Sweeping the last place they were seen.
   *
   * A widening spiral around the anchor rather than a straight line to it: an
   * officer who walks to the exact spot and stops is an officer who is trivial
   * to hide four metres from. The sweep is also what gives evidence a chance
   * to be found, since `HeatSystem` checks officer positions against scenes.
   */
  private doSearch(dt: number, world: PoliceWorld, seen: ReturnType<PoliceWorld['sees']>): void {
    if (seen) {
      world.say(this.id, 'halt');
      this.to('approach');
      return;
    }

    const anchor = this.searchAnchor ?? world.belief?.at ?? null;
    if (!anchor) {
      this.to('disengage');
      world.say(this.id, 'stand_down');
      return;
    }

    this.searchAngle += dt * 0.9;
    const radius = Math.min(SEARCH_RADIUS, 3 + this.stateSeconds * 0.8);
    const to = {
      x: anchor.x + Math.cos(this.searchAngle) * radius,
      y: anchor.y,
      z: anchor.z + Math.sin(this.searchAngle) * radius,
    };
    this.goalValue = to;
    world.moveTo(this.id, to, WALK_SPEED * 1.6);

    if (this.stateSeconds >= SEARCH_SECONDS) {
      world.say(this.id, 'lost');
      this.to('disengage');
      this.searchAnchor = null;
      this.ownSighting = null;
    }
  }

  /** Back to the beat, and forget everything. */
  reset(world: PoliceWorld): void {
    this.to('patrol');
    this.ownSighting = null;
    this.searchAnchor = null;
    this.goalValue = null;
    this.sinceSeen = 0;
    world.halt(this.id);
  }
}

// ---------------------------------------------------------------------------
// The squad
// ---------------------------------------------------------------------------

export interface PoliceStats {
  readonly officers: number;
  readonly pursuing: number;
  readonly searching: number;
  readonly roadblocks: number;
  readonly pathFailures: number;
}

/**
 * Every officer currently involved, and how many there should be.
 *
 * Units are created and retired by Heat level rather than spawned near the
 * player: an officer who appears because the player is wanted is an officer
 * who appeared from nowhere, and the host is responsible for placing new ones
 * somewhere plausible — a station, a patrol route, a junction.
 */
export class PoliceSystem {
  private readonly units = new Map<string, PoliceUnit>();
  private roadblockCount = 0;

  get all(): readonly PoliceUnit[] {
    return [...this.units.values()];
  }

  get stats(): PoliceStats {
    let pursuing = 0;
    let searching = 0;
    let pathFailures = 0;
    for (const u of this.units.values()) {
      if (u.state === 'pursue' || u.state === 'pursue_vehicle') pursuing++;
      if (u.state === 'search' || u.state === 'investigate') searching++;
      pathFailures += u.pathFailures;
    }
    return {
      officers: this.units.size,
      pursuing,
      searching,
      roadblocks: this.roadblockCount,
      pathFailures,
    };
  }

  /** How many officers and cars this Heat level wants. */
  wanted(heat: number): HeatTier {
    return tierFor(heat);
  }

  add(id: string): PoliceUnit {
    const existing = this.units.get(id);
    if (existing) return existing;
    const unit = new PoliceUnit(id);
    this.units.set(id, unit);
    return unit;
  }

  remove(id: string, world: PoliceWorld): void {
    const unit = this.units.get(id);
    if (!unit) return;
    unit.reset(world);
    this.units.delete(id);
  }

  setRoadblocks(n: number): void {
    this.roadblockCount = Math.max(0, n);
  }

  update(dt: number, world: PoliceWorld): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    for (const unit of this.units.values()) unit.update(dt, world);
  }

  /** True once every officer has given up. What ends an encounter. */
  allDisengaged(): boolean {
    if (this.units.size === 0) return true;
    for (const u of this.units.values()) {
      if (u.state !== 'patrol' && u.state !== 'disengage') return false;
    }
    return true;
  }

  snapshots(world: PoliceWorld): OfficerSnapshot[] {
    return this.all.map((u) => u.snapshot(world));
  }

  clear(world: PoliceWorld): void {
    for (const u of this.units.values()) u.reset(world);
    this.units.clear();
    this.roadblockCount = 0;
  }
}

function distance(a: Vec3Like, b: Vec3Like): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}
