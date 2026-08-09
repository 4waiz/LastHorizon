import { describe, it, expect } from 'vitest';
import { NpcAgent, shortestAngle, type AgentDeps } from '../src/npc/NpcAgent';
import type { NavService } from '../src/nav/NavService';
import type { Vec3Like } from '../src/nav/NavTypes';
import { npcById } from '../src/npc/npcCatalog';
import { scheduleById } from '../src/npc/schedules';
import * as THREE from 'three';

/**
 * The agent, with navigation stubbed.
 *
 * Deliberately not against the real `NavService`: this file is about what the
 * agent does with an answer, not about whether Recast gives a good one, and
 * pulling in 900 kB of WebAssembly to test a stuck timer would make the unit
 * suite something nobody runs.
 */

interface Stub {
  deps: AgentDeps;
  nav: {
    pathCalls: number;
    samples: number;
    /** What `path` returns. Default is the straight line. */
    corners: Vec3Like[] | null;
    /** What `sample` returns. Null models "off the navmesh". */
    sampleResult: Vec3Like | null;
    /** Set to model a crowd being available, as it is once Recast has landed. */
    crowdAvailable: boolean;
    liveAgents: number;
  };
}

function stub(): Stub {
  const state: Stub['nav'] = {
    pathCalls: 0,
    samples: 0,
    corners: null,
    sampleResult: null,
    crowdAvailable: false,
    liveAgents: 0,
  };

  // A crowd agent that stands exactly where it was put. Enough to exercise
  // attach and detach without a navmesh; steering itself is Detour's problem
  // and is checked in the browser, not here.
  const makeAgent = (at: Vec3Like) => {
    const position = { x: at.x, y: at.y, z: at.z };
    return {
      id: ++state.liveAgents,
      position,
      velocity: { x: 0, y: 0, z: 0 },
      onLink: false,
      setTarget: () => undefined,
      teleport: (p: Vec3Like) => {
        position.x = p.x;
        position.y = p.y;
        position.z = p.z;
      },
      setMaxSpeed: () => undefined,
    };
  };

  const nav = {
    ready: false,
    path: (from: Vec3Like, to: Vec3Like) => {
      state.pathCalls++;
      return state.corners ?? [from, to];
    },
    sample: () => {
      state.samples++;
      return state.sampleResult;
    },
    addAgent: (at: Vec3Like) => (state.crowdAvailable ? makeAgent(at) : null),
    removeAgent: () => {
      state.liveAgents--;
    },
    update: () => undefined,
  } as unknown as NavService;

  return {
    nav: state,
    deps: {
      nav,
      visuals: null,
      group: new THREE.Group(),
      heightAt: () => 0,
    },
  };
}

function ambient(deps: AgentDeps): NpcAgent {
  return new NpcAgent(
    'amb_test',
    'ambient',
    null,
    { shirt: '#fff', trousers: '#000', hat: null, scale: 1, build: 'average' },
    null,
    deps,
  );
}

function maryam(deps: AgentDeps): NpcAgent {
  const def = npcById('v_maryam')!;
  return new NpcAgent('v_maryam', 'named', def, def.appearance, scheduleById(def.scheduleId), deps);
}

describe('coarse movement', () => {
  it('walks toward its destination', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 20);

    for (let i = 0; i < 60; i++) a.update(1 / 30);
    expect(a.position.z).toBeGreaterThan(1);
    expect(a.position.z).toBeLessThan(20);
  });

  it('arrives and stops', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 6);

    for (let i = 0; i < 600; i++) a.update(1 / 30);
    expect(a.arrived).toBe(true);
    expect(a.movingSpeed).toBeLessThan(0.05);
  });

  it('follows the corner list rather than the straight line', () => {
    // Corners come from a navmesh query, which is what keeps a mid-tier NPC
    // out of the walls it is not steering around.
    const s = stub();
    s.nav.corners = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 10 },
    ];
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(10, 10);

    for (let i = 0; i < 120; i++) a.update(1 / 30);
    // Went east first, not diagonally.
    expect(a.position.x).toBeGreaterThan(2);
    expect(a.position.z).toBeLessThan(2);
  });

  it('faces the way it is walking', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(20, 0);
    a.update(1 / 30);
    // Heading +X is atan2(1, 0) = pi/2 in the glTF convention.
    expect(a.facing).toBeCloseTo(Math.PI / 2, 3);
  });

  it('counts as arrived when it has nowhere to be', () => {
    const s = stub();
    const a = ambient(s.deps);
    expect(a.arrived).toBe(true);
  });

  it('does not re-path for a destination it already has', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(5, 5);
    const after = s.nav.pathCalls;
    a.setDestination(5.1, 5.1);
    expect(s.nav.pathCalls).toBe(after);
  });

  it('accumulates waiting time once it has arrived', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 0.5);
    for (let i = 0; i < 60; i++) a.update(1 / 30);
    expect(a.waiting).toBeGreaterThan(1);
    a.resetWait();
    expect(a.waiting).toBe(0);
  });
});

describe('stuck recovery', () => {
  /** Deps whose ground query pins the agent, modelling a wall it cannot pass. */
  function wedged(): Stub {
    const s = stub();
    const a = { ...s.deps };
    return { nav: s.nav, deps: a };
  }

  it('re-paths before giving up', () => {
    const s = wedged();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 50);

    const before = s.nav.pathCalls;
    // Freeze the agent by driving update with a zero step: it wants to move and
    // measurably is not.
    for (let i = 0; i < 200; i++) a.update(0);
    // A zero dt cannot accumulate the stuck timer either, so nothing happens.
    expect(s.nav.pathCalls).toBe(before);
  });

  it('moves a wedged agent to the furthest reachable point on its route', () => {
    // Wedged is modelled with a crowd agent that refuses to move, which is the
    // real case: Detour has the agent and will not take it anywhere.
    const s = stub();
    s.nav.crowdAvailable = true;
    s.nav.corners = [
      { x: 0, y: 0, z: 0 },
      { x: 0, y: 0, z: 48 },
    ];

    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 50);
    a.setBand('near');

    for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);

    expect(a.stats.stuckRecoveries).toBeGreaterThan(0);
    expect(a.stats.teleports).toBeGreaterThan(0);
    // Placed on the route, not at the raw goal and not on some island near it.
    expect(a.position.z).toBeCloseTo(48, 1);
  });

  it('never places an agent somewhere no route reaches', () => {
    // The bug this exists for: a building collider is a hollow box to Recast
    // and the terrain runs on underneath, so every house has an unreachable
    // navmesh island inside it. `sample` answers with that island quite
    // happily; a path corner cannot, because it is reachable by construction.
    const s = stub();
    s.nav.crowdAvailable = true;
    s.nav.corners = [{ x: 0, y: 0, z: 0 }];
    s.nav.sampleResult = { x: 0, y: 0, z: 50 }; // the island, tempting and wrong

    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 50);
    a.setBand('near');

    for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);

    expect(a.position.z).toBeCloseTo(0, 1);
    expect(a.stats.teleports).toBe(0);
    expect(a.stats.abandoned).toBeGreaterThan(0);
  });

  it('does not count a standing agent with nowhere to go as stuck', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);
    expect(a.stats.stuckRecoveries).toBe(0);
  });

  it('does not count an agent that has arrived as stuck', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 3);
    for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);
    expect(a.arrived).toBe(true);
    expect(a.stats.stuckRecoveries).toBe(0);
  });

  it('abandons a destination the navmesh cannot reach, rather than warping into it', () => {
    // The first version placed the agent at the raw goal when sampling failed,
    // which walks people into the middle of a house — the exact thing the
    // acceptance criteria forbid.
    const s = stub();
    s.nav.corners = [{ x: 0, y: 0, z: 0 }];
    s.nav.sampleResult = null;

    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 40);
    for (let i = 0; i < 60 * 30; i++) a.update(1 / 30);

    expect(a.position.z).toBeCloseTo(0, 1);
    expect(a.stats.abandoned).toBeGreaterThan(0);
    expect(a.stats.teleports).toBe(0);
    expect(a.target).toBeNull();
  });
});

describe('schedules', () => {
  it('sends a resident to the anchor their schedule names', () => {
    const s = stub();
    const a = maryam(s.deps);
    const def = npcById('v_maryam')!;

    // early_trade is at work from 07:00.
    a.applySchedule(9);
    expect(a.activity).toBe('work');
    expect(a.target?.x).toBeCloseTo(def.anchors.work.x, 6);
    expect(a.target?.z).toBeCloseTo(def.anchors.work.z, 6);
  });

  it('reports whether the activity changed, so the far tier can skip work', () => {
    const s = stub();
    const a = maryam(s.deps);
    expect(a.applySchedule(9)).toBe(true);
    expect(a.applySchedule(9.5)).toBe(false);
  });

  it('goes indoors to sleep, but only once actually home', () => {
    const s = stub();
    const a = maryam(s.deps);
    const def = npcById('v_maryam')!;

    // Standing in the street at bedtime: still outdoors, and heading home.
    a.placeAt(0, 0);
    a.applySchedule(23);
    expect(a.activity).toBe('sleep');
    expect(a.indoors).toBe(false);

    // On the doorstep: inside.
    a.placeAt(def.anchors.home.x, def.anchors.home.z);
    a.applySchedule(23);
    expect(a.indoors).toBe(true);
  });

  it('does not move or animate while indoors', () => {
    const s = stub();
    const a = maryam(s.deps);
    const def = npcById('v_maryam')!;
    a.placeAt(def.anchors.home.x, def.anchors.home.z);
    a.applySchedule(23);

    const before = a.position.clone();
    for (let i = 0; i < 120; i++) a.update(1 / 30);
    expect(a.position.distanceTo(before)).toBe(0);
    expect(a.movingSpeed).toBe(0);
  });

  it('handles the midnight wrap through the agent, not only the pure function', () => {
    const s = stub();
    const a = maryam(s.deps);
    a.applySchedule(2);
    expect(a.activity).toBe('sleep');
  });

  it('lets a quest override the schedule entirely', () => {
    const s = stub();
    const a = maryam(s.deps);
    a.questOverride = { kind: 'quest', place: { x: 40, y: 0, z: -8 } };
    a.applySchedule(9);
    expect(a.activity).toBe('quest');
    expect(a.target?.x).toBe(40);
    // A quest never leaves somebody stuck inside a building.
    expect(a.indoors).toBe(false);
  });

  it('does nothing for an ambient pedestrian with no schedule', () => {
    const s = stub();
    const a = ambient(s.deps);
    expect(a.applySchedule(9)).toBe(false);
  });
});

describe('LOD transitions', () => {
  it('is idempotent for the band it is already in', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.setBand('far');
    expect(a.band).toBe('far');
    a.setBand('far');
    expect(a.band).toBe('far');
  });

  it('never takes a body while indoors', () => {
    const s = stub();
    const a = maryam(s.deps);
    const def = npcById('v_maryam')!;
    a.placeAt(def.anchors.home.x, def.anchors.home.z);
    a.applySchedule(23);
    a.setBand('near');
    expect(a.hasBody).toBe(false);
  });

  it('takes a crowd agent on entering the near tier and gives it back on leaving', () => {
    const s = stub();
    s.nav.crowdAvailable = true;
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 30);

    a.setBand('near');
    expect(s.nav.liveAgents).toBe(1);
    a.setBand('mid');
    expect(s.nav.liveAgents).toBe(0);
  });

  it('does not take a second crowd agent for a band it is already in', () => {
    const s = stub();
    s.nav.crowdAvailable = true;
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    for (let i = 0; i < 10; i++) a.setBand('near');
    expect(s.nav.liveAgents).toBe(1);
  });

  it('re-paths on dropping out of the near tier', () => {
    // The crowd may have left the agent somewhere the old corner list does not
    // start from.
    const s = stub();
    s.nav.crowdAvailable = true;
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(0, 30);
    a.setBand('near');
    const before = s.nav.pathCalls;
    a.setBand('mid');
    expect(s.nav.pathCalls).toBeGreaterThan(before);
  });

  it('gives the crowd agent back on dispose', () => {
    const s = stub();
    s.nav.crowdAvailable = true;
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.setDestination(1, 1);
    a.setBand('near');
    a.dispose();
    expect(s.nav.liveAgents).toBe(0);
    expect(a.target).toBeNull();
  });
});

describe('reactions', () => {
  it('turns to face what it is greeting', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.react('greet', { x: 10, y: 0, z: 0 });
    expect(a.reaction).toBe('greet');
    expect(a.facing).toBeCloseTo(Math.PI / 2, 3);
  });

  it('runs away from what frightened it', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.react('flee', { x: 0, y: 0, z: 10 });
    expect(a.target!.z).toBeLessThan(0);
  });

  it('sidesteps rather than retreating from a car', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.react('step_aside', { x: 0, y: 0, z: 10 });
    // Perpendicular: it moved in x, not straight back along z.
    expect(Math.abs(a.target!.x)).toBeGreaterThan(Math.abs(a.target!.z));
  });

  it('lets a reaction lapse rather than holding it forever', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.placeAt(0, 0);
    a.react('watch', { x: 5, y: 0, z: 0 });
    expect(a.reaction).toBe('watch');
    for (let i = 0; i < 200; i++) a.update(1 / 30);
    expect(a.reaction).toBeNull();
  });

  it('ignores "resume", which is the absence of a reaction', () => {
    const s = stub();
    const a = ambient(s.deps);
    a.react('resume', { x: 1, y: 0, z: 1 });
    expect(a.reaction).toBeNull();
  });
});

describe('ageing', () => {
  it('starts at the catalogue age and advances with birthdays', () => {
    const s = stub();
    const a = maryam(s.deps);
    expect(a.age).toBe(npcById('v_maryam')!.startAge);
    a.advanceAge(1);
    a.advanceAge(1);
    expect(a.age).toBe(npcById('v_maryam')!.startAge + 2);
  });
});

describe('shortestAngle', () => {
  it('takes the short way round', () => {
    expect(shortestAngle(0.2)).toBeCloseTo(0.2, 9);
    expect(shortestAngle(Math.PI * 2 - 0.2)).toBeCloseTo(-0.2, 9);
    expect(shortestAngle(-Math.PI * 2 + 0.2)).toBeCloseTo(0.2, 9);
  });
});
