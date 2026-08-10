import { beforeEach, describe, expect, it } from 'vitest';
import {
  ARREST_RANGE,
  BELIEF_STALE_SECONDS,
  HEAT_TIERS,
  LOSE_SIGHT_SECONDS,
  PoliceSystem,
  PoliceUnit,
  SEARCH_SECONDS,
  WARN_RANGE,
  WARN_SECONDS,
  tierFor,
  type PoliceLine,
  type PoliceWorld,
} from '../src/crime/PoliceSystem';
import type { HeatBelief } from '../src/crime/Heat';
import type { Vec3Like } from '../src/nav/NavTypes';

/**
 * Police behaviour, against a fake world.
 *
 * The fake is the point. `PoliceWorld` is the only way an officer learns
 * anything, and `sees()` is the only method on it that returns the player's
 * position — so a test can hand an officer a world where the player is
 * standing right there and invisible, and watch it do the right thing.
 */

class FakeWorld implements PoliceWorld {
  belief: HeatBelief | null = null;
  heat = 0;
  playerDriving = false;

  /** Where the player actually is. Officers only learn it through `sees`. */
  playerAt: Vec3Like = { x: 0, y: 0, z: 0 };
  /** Whether each officer can perceive them. Default: no. */
  visibleTo = new Set<string>();

  readonly positions = new Map<string, Vec3Like>();
  readonly moves: Array<{ id: string; to: Vec3Like; speed: number }> = [];
  readonly lines: Array<{ id: string; line: PoliceLine }> = [];
  readonly arrests: string[] = [];
  failPathFor = new Set<string>();
  carFor = new Set<string>();
  /** Teleport officers to their goal each tick, so tests converge fast. */
  instantMovement = true;

  place(id: string, at: Vec3Like): void {
    this.positions.set(id, { ...at });
  }

  sees(officerId: string) {
    if (!this.visibleTo.has(officerId)) return null;
    const at = this.positionOf(officerId);
    return {
      at: { ...this.playerAt },
      distance: Math.hypot(at.x - this.playerAt.x, at.y - this.playerAt.y, at.z - this.playerAt.z),
    };
  }

  positionOf(officerId: string): Vec3Like {
    return this.positions.get(officerId) ?? { x: 0, y: 0, z: 0 };
  }

  moveTo(officerId: string, to: Vec3Like, speed: number): void {
    this.moves.push({ id: officerId, to: { ...to }, speed });
    if (this.instantMovement) this.positions.set(officerId, { ...to });
  }

  halt(): void {}

  hasVehicle(officerId: string): boolean {
    return this.carFor.has(officerId);
  }

  say(officerId: string, line: PoliceLine): void {
    this.lines.push({ id: officerId, line });
  }

  arrest(officerId: string): void {
    this.arrests.push(officerId);
  }

  pathFailed(officerId: string): boolean {
    return this.failPathFor.delete(officerId);
  }

  // -- helpers ------------------------------------------------------------

  /**
   * Age the belief, the way `HeatSystem.advance` does.
   *
   * The first draft of this fake held a belief that never aged, and two tests
   * failed because an officer who gave up immediately re-investigated the same
   * cold report forever. That was the fake being unrealistic rather than the
   * unit being wrong — a real belief goes stale — so the fake does it too.
   */
  tick(dt: number): void {
    if (this.belief) this.belief = { ...this.belief, age: this.belief.age + dt };
  }

  said(line: PoliceLine): boolean {
    return this.lines.some((l) => l.line === line);
  }
  lastMove(): { id: string; to: Vec3Like; speed: number } | undefined {
    return this.moves[this.moves.length - 1];
  }
}

const BELIEF = (at: Vec3Like, age = 0): HeatBelief => ({ at, age, source: 'witness' });

describe('heat tiers', () => {
  it('sends nobody at zero', () => {
    expect(tierFor(0)).toEqual({ officers: 0, vehicles: 0, roadblocks: 0 });
  });

  it('escalates monotonically and stops at five', () => {
    for (let i = 1; i < HEAT_TIERS.length; i++) {
      expect(HEAT_TIERS[i].officers).toBeGreaterThanOrEqual(HEAT_TIERS[i - 1].officers);
      expect(HEAT_TIERS[i].vehicles).toBeGreaterThanOrEqual(HEAT_TIERS[i - 1].vehicles);
    }
    expect(tierFor(9)).toEqual(HEAT_TIERS[HEAT_TIERS.length - 1]);
  });

  it('stays inside the draw-call budget Phase 6 measured', () => {
    // One draw call and 4,890 triangles a body, ~60 calls of headroom at the
    // `high` preset. Five bodies plus two cars is the ceiling.
    const top = HEAT_TIERS[HEAT_TIERS.length - 1];
    expect(top.officers + top.vehicles).toBeLessThanOrEqual(5);
  });

  it('holds cars back until the player is properly wanted', () => {
    expect(tierFor(1).vehicles).toBe(0);
    expect(tierFor(2).vehicles).toBe(0);
    expect(tierFor(3).vehicles).toBeGreaterThan(0);
  });

  it('keeps roadblocks for the top two levels only', () => {
    expect(tierFor(3).roadblocks).toBe(0);
    expect(tierFor(4).roadblocks).toBeGreaterThan(0);
  });
});

describe('an officer who cannot see anybody', () => {
  let world: FakeWorld;
  let unit: PoliceUnit;

  beforeEach(() => {
    world = new FakeWorld();
    unit = new PoliceUnit('p1');
    world.place('p1', { x: 0, y: 0, z: 0 });
  });

  it('does nothing at all when there is no heat', () => {
    world.playerAt = { x: 1, y: 0, z: 1 };
    unit.update(1, world);
    expect(unit.state).toBe('patrol');
    expect(world.moves).toHaveLength(0);
  });

  it('never walks toward a player it cannot perceive', () => {
    // The behavioural half of criterion 2. The player is standing four metres
    // away and invisible; the report said somewhere else entirely. The officer
    // goes where the report said, and the *move* is the assertion — the state
    // it ends the tick in depends on how fast the fake lets it walk.
    world.heat = 2;
    world.playerAt = { x: 4, y: 0, z: 0 };
    world.belief = BELIEF({ x: 50, y: 0, z: 50 });

    unit.update(1, world);
    expect(world.moves).toHaveLength(1);
    expect(world.moves[0].to).toEqual({ x: 50, y: 0, z: 50 });
    // Nothing it did went anywhere near where the player actually is.
    for (const m of world.moves) expect(m.to).not.toEqual(world.playerAt);
  });

  it('has nothing to go on when there is no belief, and sweeps where it stands', () => {
    world.heat = 2;
    world.playerAt = { x: 3, y: 0, z: 0 };
    world.belief = null;

    unit.update(1, world);
    // No belief at all: patrol has nowhere to investigate.
    expect(unit.state).toBe('patrol');
  });

  it('searches once it arrives and finds nobody', () => {
    world.heat = 2;
    world.belief = BELIEF({ x: 10, y: 0, z: 0 });

    unit.update(1, world); // investigate, teleported to the belief
    unit.update(1, world); // arrived, nobody here
    expect(unit.state).toBe('search');
  });

  it('gives up once the search is exhausted and the report has gone cold', () => {
    world.heat = 2;
    world.belief = BELIEF({ x: 10, y: 0, z: 0 });
    unit.update(1, world);
    expect(unit.state).toBe('search');

    // Two conditions, not one, and the test needed correcting to say so. An
    // officer who has swept for `SEARCH_SECONDS` gives up — and then, while the
    // report is still fresh, goes back and sweeps again. Only a *stale* belief
    // makes disengaging stick, which is the behaviour we want: a call that came
    // in thirty seconds ago is worth a second look.
    for (let i = 0; i < SEARCH_SECONDS + BELIEF_STALE_SECONDS + 2; i++) {
      unit.update(1, world);
      world.tick(1);
    }
    expect(unit.state).toBe('disengage');
    expect(world.said('lost')).toBe(true);
  });

  it('recovers from a failed path by sweeping instead of freezing', () => {
    world.heat = 2;
    world.belief = BELIEF({ x: 10, y: 0, z: 0 });
    world.failPathFor.add('p1');

    unit.update(1, world);
    expect(unit.state).toBe('search');
    expect(unit.pathFailures).toBe(1);
  });
});

describe('an officer who can see the player', () => {
  let world: FakeWorld;
  let unit: PoliceUnit;

  beforeEach(() => {
    world = new FakeWorld();
    unit = new PoliceUnit('p1');
    world.place('p1', { x: 0, y: 0, z: 0 });
    world.heat = 2;
    world.visibleTo.add('p1');
    world.playerAt = { x: 20, y: 0, z: 0 };
  });

  it('approaches, warns, and arrests somebody who stands still', () => {
    // The non-lethal route through every encounter, start to finish.
    unit.update(0.5, world); // sees them, approach
    expect(unit.state).toBe('approach');

    world.playerAt = { x: 1, y: 0, z: 0 };
    world.place('p1', { x: 0, y: 0, z: 0 });
    unit.update(0.5, world);
    expect(unit.state).toBe('warn');
    expect(world.said('warn')).toBe(true);

    // Close enough to put hands on, and they have not moved.
    world.playerAt = { x: ARREST_RANGE - 0.5, y: 0, z: 0 };
    unit.update(0.5, world);
    expect(unit.state).toBe('arrest');
    expect(world.arrests).toEqual(['p1']);
    expect(world.said('surrender')).toBe(true);
  });

  it('chases somebody who walks away from a warning', () => {
    // Inside talking range but outside arm's reach, so the warning actually
    // happens rather than going straight to an arrest.
    world.playerAt = { x: WARN_RANGE - 0.5, y: 0, z: 0 };
    world.instantMovement = false;
    unit.update(0.5, world);
    unit.update(0.5, world);
    expect(unit.state).toBe('warn');

    // They backed off past talking range.
    world.playerAt = { x: WARN_RANGE * 2, y: 0, z: 0 };
    unit.update(0.5, world);
    expect(unit.state).toBe('pursue');
    expect(world.said('halt')).toBe(true);
  });

  it('gives them the warning seconds before chasing', () => {
    // Inside talking range but outside arm's reach, so the warning actually
    // happens rather than going straight to an arrest.
    world.playerAt = { x: WARN_RANGE - 0.5, y: 0, z: 0 };
    world.instantMovement = false;
    unit.update(0.5, world);
    unit.update(0.5, world);
    expect(unit.state).toBe('warn');

    unit.update(WARN_SECONDS - 1, world);
    expect(unit.state).toBe('warn');
    unit.update(2, world);
    expect(unit.state).toBe('pursue');
  });

  it('takes a car when the player drives, and only if it has one', () => {
    world.instantMovement = false;
    world.playerAt = { x: WARN_RANGE - 0.5, y: 0, z: 0 };
    unit.update(0.5, world);
    unit.update(0.5, world);
    world.playerDriving = true;
    world.playerAt = { x: 30, y: 0, z: 0 };

    unit.update(1, world);
    expect(unit.state).toBe('pursue'); // on foot: no car available
    world.carFor.add('p1');
    unit.update(1, world);
    expect(unit.state).toBe('pursue_vehicle');
  });

  it('does not arrest somebody through a car window', () => {
    world.instantMovement = false;
    world.playerDriving = true;
    world.carFor.add('p1');
    // Right beside the car window, which is exactly the case that used to let
    // an officer reach in and arrest a driver mid-getaway.
    world.playerAt = { x: 1, y: 0, z: 0 };

    unit.update(0.5, world);
    unit.update(0.5, world);
    expect(unit.state).toBe('pursue_vehicle');

    unit.update(1, world);
    expect(world.arrests).toEqual([]);
  });
});

describe('losing them', () => {
  let world: FakeWorld;
  let unit: PoliceUnit;

  beforeEach(() => {
    world = new FakeWorld();
    unit = new PoliceUnit('p1');
    world.place('p1', { x: 0, y: 0, z: 0 });
    world.heat = 3;
    world.visibleTo.add('p1');
    world.playerAt = { x: 6, y: 0, z: 0 };
    world.instantMovement = false;
    unit.update(0.5, world);
    unit.update(WARN_SECONDS + 1, world);
  });

  it('runs to where they last were, briefly', () => {
    const lastSeen = { ...world.playerAt };
    world.visibleTo.clear();
    world.playerAt = { x: 200, y: 0, z: 200 };

    unit.update(1, world);
    // Still heading for the last sighting, not the new position.
    expect(world.lastMove()!.to.x).toBeCloseTo(lastSeen.x, 3);
  });

  it('gives up the chase and starts searching', () => {
    world.visibleTo.clear();
    for (let i = 0; i < LOSE_SIGHT_SECONDS + 1; i++) unit.update(1, world);
    expect(unit.state).toBe('search');
    expect(world.said('lost')).toBe(true);
  });

  it('picks the chase back up on seeing them again', () => {
    world.visibleTo.clear();
    for (let i = 0; i < LOSE_SIGHT_SECONDS + 1; i++) unit.update(1, world);
    expect(unit.state).toBe('search');

    world.visibleTo.add('p1');
    unit.update(0.5, world);
    expect(unit.state).toBe('approach');
  });

  it('sweeps a widening circle rather than standing on the spot', () => {
    // An officer who walks to the exact place and stops is trivial to hide
    // four metres from.
    world.visibleTo.clear();
    for (let i = 0; i < LOSE_SIGHT_SECONDS + 1; i++) unit.update(1, world);

    const before = world.moves.length;
    unit.update(1, world);
    unit.update(1, world);
    const sweep = world.moves.slice(before);
    expect(sweep.length).toBeGreaterThanOrEqual(2);
    expect(sweep[0].to).not.toEqual(sweep[1].to);
  });

  it('stands down the moment heat reaches zero', () => {
    world.heat = 0;
    unit.update(1, world);
    expect(unit.state).toBe('patrol');
    expect(world.said('stand_down')).toBe(true);
  });
});

describe('the squad', () => {
  it('reports what everybody is doing', () => {
    const world = new FakeWorld();
    world.heat = 4;
    const squad = new PoliceSystem();
    for (const id of ['a', 'b', 'c']) {
      squad.add(id);
      world.place(id, { x: 0, y: 0, z: 0 });
    }
    world.belief = BELIEF({ x: 30, y: 0, z: 0 });
    squad.update(1, world);

    expect(squad.stats.officers).toBe(3);
    expect(squad.stats.searching).toBe(3);
  });

  it('is idle only when everybody has given up', () => {
    const world = new FakeWorld();
    const squad = new PoliceSystem();
    squad.add('a');
    world.place('a', { x: 0, y: 0, z: 0 });

    expect(squad.allDisengaged()).toBe(true);

    world.heat = 2;
    world.belief = BELIEF({ x: 30, y: 0, z: 0 });
    squad.update(1, world);
    expect(squad.allDisengaged()).toBe(false);

    world.heat = 0;
    squad.update(1, world);
    expect(squad.allDisengaged()).toBe(true);
  });

  it('does not add the same officer twice', () => {
    const squad = new PoliceSystem();
    const a = squad.add('a');
    expect(squad.add('a')).toBe(a);
    expect(squad.stats.officers).toBe(1);
  });

  it('clears everybody on demand', () => {
    const world = new FakeWorld();
    const squad = new PoliceSystem();
    squad.add('a');
    squad.add('b');
    squad.setRoadblocks(2);

    squad.clear(world);
    expect(squad.stats.officers).toBe(0);
    expect(squad.stats.roadblocks).toBe(0);
  });
});
