import { describe, it, expect } from 'vitest';
import {
  angleDelta,
  chooseReaction,
  DEFAULT_SENSES,
  PerceptionBus,
  perceive,
  type Observer,
  type PerceptionEvent,
} from '../src/npc/Perception';

/**
 * The gate that matters most here is occlusion, because the Phase 9 police
 * system will be built on top of this and "police never know without a valid
 * information path" is an acceptance criterion that has to hold at this layer
 * or it cannot hold at all.
 */

const observer = (over: Partial<Observer> = {}): Observer => ({
  id: 'watcher',
  eye: { x: 0, y: 1.6, z: 0 },
  // Facing +Z, glTF convention: atan2(dir.x, dir.z) === 0.
  facing: 0,
  sightRange: DEFAULT_SENSES.sightRange,
  fov: DEFAULT_SENSES.fov,
  hearingRange: DEFAULT_SENSES.hearingRange,
  ...over,
});

const event = (over: Partial<PerceptionEvent> = {}): PerceptionEvent => ({
  id: 1,
  kind: 'theft',
  at: { x: 0, y: 1.6, z: 10 },
  actor: 'player',
  loudness: 0,
  severity: 0.5,
  criminal: true,
  ...over,
});

describe('sight', () => {
  it('sees something straight ahead and in range', () => {
    const p = perceive(observer(), event(), false);
    expect(p.perceived).toBe(true);
    expect(p.via).toBe('sight');
    expect(p.confidence).toBeGreaterThan(0.5);
  });

  it('does not see behind itself', () => {
    const p = perceive(observer(), event({ at: { x: 0, y: 1.6, z: -10 } }), false);
    expect(p.perceived).toBe(false);
  });

  it('does not see past its own range', () => {
    const p = perceive(observer({ sightRange: 8 }), event(), false);
    expect(p.perceived).toBe(false);
  });

  it('is stopped by a wall', () => {
    const p = perceive(observer(), event(), true);
    expect(p.perceived).toBe(false);
    expect(p.via).toBeNull();
  });

  it('is less confident at the edge of vision than dead ahead', () => {
    const ahead = perceive(observer(), event({ at: { x: 0, y: 1.6, z: 10 } }), false);
    // 65 degrees off-centre, just inside the 140-degree cone.
    const angle = (65 * Math.PI) / 180;
    const edge = perceive(
      observer(),
      event({ at: { x: Math.sin(angle) * 10, y: 1.6, z: Math.cos(angle) * 10 } }),
      false,
    );
    expect(edge.perceived).toBe(true);
    expect(edge.confidence).toBeLessThan(ahead.confidence);
  });

  it('is less confident far away than close', () => {
    const near = perceive(observer(), event({ at: { x: 0, y: 1.6, z: 4 } }), false);
    const far = perceive(observer(), event({ at: { x: 0, y: 1.6, z: 24 } }), false);
    expect(far.confidence).toBeLessThan(near.confidence);
  });
});

describe('hearing', () => {
  it('notices a loud thing behind a wall, at reduced confidence', () => {
    const behindWall = perceive(
      observer(),
      event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -12 } }),
      true,
    );
    expect(behindWall.perceived).toBe(true);
    expect(behindWall.via).toBe('hearing');
    expect(behindWall.confidence).toBeLessThan(0.6);
  });

  it('hears things behind it, where sight cannot reach', () => {
    const p = perceive(observer(), event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -20 } }), false);
    expect(p.via).toBe('hearing');
  });

  it('does not hear a silent event', () => {
    const p = perceive(observer(), event({ loudness: 0, at: { x: 0, y: 1.6, z: -10 } }), false);
    expect(p.perceived).toBe(false);
  });

  it('is capped by the observer, not only by the event', () => {
    // A 90 m gunshot heard by somebody with a 34 m hearing range is a 34 m
    // gunshot. Without the cap, loudness alone would let one event be heard
    // across a whole district.
    const near = perceive(observer(), event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -30 } }), false);
    const beyond = perceive(observer(), event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -40 } }), false);
    expect(near.perceived).toBe(true);
    expect(beyond.perceived).toBe(false);
  });

  it('carries less far through a wall', () => {
    const clear = perceive(observer(), event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -25 } }), false);
    const blocked = perceive(observer(), event({ kind: 'gunshot', loudness: 90, at: { x: 0, y: 1.6, z: -25 } }), true);
    expect(clear.perceived).toBe(true);
    expect(blocked.perceived).toBe(false);
  });
});

describe('angleDelta', () => {
  it('returns the shortest signed difference', () => {
    expect(angleDelta(0.1, -0.1)).toBeCloseTo(0.2, 6);
    expect(angleDelta(-Math.PI + 0.1, Math.PI - 0.1)).toBeCloseTo(0.2, 6);
    expect(Math.abs(angleDelta(0, Math.PI))).toBeCloseTo(Math.PI, 6);
  });
});

describe('reactions', () => {
  const base = { confidence: 0.8, distance: 12, fear: 0, familiarity: 0 };

  it('does nothing when barely noticed', () => {
    expect(chooseReaction({ ...base, kind: 'crime', confidence: 0.05 })).toBe('resume');
  });

  it('runs from a gunshot nearby and calls for help from a distance', () => {
    expect(chooseReaction({ ...base, kind: 'gunshot', distance: 6 })).toBe('flee');
    expect(chooseReaction({ ...base, kind: 'gunshot', distance: 40 })).toBe('call_help');
  });

  it('steps aside for a car', () => {
    expect(chooseReaction({ ...base, kind: 'dangerous_driving', distance: 3 })).toBe('step_aside');
    expect(chooseReaction({ ...base, kind: 'dangerous_driving', distance: 20 })).toBe('watch');
  });

  it('greets a familiar face and watches a stranger', () => {
    expect(chooseReaction({ ...base, kind: 'greeting', familiarity: 0.5, distance: 10 })).toBe('greet');
    expect(chooseReaction({ ...base, kind: 'greeting', familiarity: 0, distance: 10 })).toBe('watch');
    // Close enough and anybody says hello.
    expect(chooseReaction({ ...base, kind: 'greeting', familiarity: 0, distance: 2 })).toBe('greet');
  });

  it('lets fear override friendliness', () => {
    expect(chooseReaction({ ...base, kind: 'greeting', familiarity: 0.9, fear: 0.6 })).toBe('watch');
    expect(chooseReaction({ ...base, kind: 'theft', distance: 20, fear: 0.7 })).toBe('flee');
  });

  it('decides the dangerous kinds before the friendly ones', () => {
    // A marginal-confidence gunshot must never fall through to 'greet'.
    const r = chooseReaction({ ...base, kind: 'gunshot', confidence: 0.13, distance: 60 });
    expect(r === 'flee' || r === 'call_help').toBe(true);
  });
});

describe('the bus', () => {
  const never = () => false;

  it('matches events against observers and clears the queue', () => {
    const bus = new PerceptionBus();
    bus.emit('greeting', { x: 0, y: 1.6, z: 6 }, 'player');
    expect(bus.pending).toHaveLength(1);

    const witnesses = bus.resolve([observer()], never);
    expect(witnesses).toHaveLength(1);
    expect(witnesses[0].observerId).toBe('watcher');
    expect(bus.pending).toHaveLength(0);
  });

  it('never reports the actor as their own witness', () => {
    const bus = new PerceptionBus();
    bus.emit('greeting', { x: 0, y: 1.6, z: 1 }, 'watcher');
    expect(bus.resolve([observer()], never)).toHaveLength(0);
  });

  it('respects occlusion supplied by the caller', () => {
    const bus = new PerceptionBus();
    bus.emit('theft', { x: 0, y: 1.6, z: 8 }, 'player');
    expect(bus.resolve([observer()], () => true)).toHaveLength(0);
  });

  it('does not raycast for events that are out of every range', () => {
    const bus = new PerceptionBus();
    let rays = 0;
    bus.emit('theft', { x: 0, y: 1.6, z: 400 }, 'player');
    bus.resolve([observer()], () => {
      rays++;
      return false;
    });
    expect(rays).toBe(0);
  });

  it('counts what it has seen, for the overlay', () => {
    const bus = new PerceptionBus();
    bus.emit('greeting', { x: 0, y: 1.6, z: 5 }, 'player');
    bus.emit('greeting', { x: 0, y: 1.6, z: 5 }, 'player');
    bus.resolve([observer()], never);
    expect(bus.emitted).toBe(2);
    expect(bus.witnessed).toBe(2);
  });

  it('drops everything on clear, so a zone change carries nothing over', () => {
    const bus = new PerceptionBus();
    bus.emit('gunshot', { x: 0, y: 1.6, z: 5 }, 'player');
    bus.clear();
    expect(bus.resolve([observer()], never)).toHaveLength(0);
  });

  it('marks the criminal kinds without being told', () => {
    const bus = new PerceptionBus();
    expect(bus.emit('theft', { x: 0, y: 0, z: 0 }, 'player').criminal).toBe(true);
    expect(bus.emit('greeting', { x: 0, y: 0, z: 0 }, 'player').criminal).toBe(false);
  });
});
