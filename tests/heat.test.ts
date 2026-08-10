import { beforeEach, describe, expect, it } from 'vitest';
import {
  BELIEF_STALE_SECONDS,
  CALL_DELAY_FAR,
  CALL_DELAY_NEAR,
  HEAT_DECAY_PER_SECOND,
  HeatSystem,
} from '../src/crime/Heat';
import { CRIMES, MAX_HEAT, crimeDef, validateCrime } from '../src/crime/CrimeDefinition';

/**
 * Heat, and the promise that the police are never omniscient.
 *
 * Acceptance criterion 2 is the reason most of this file exists. The system
 * has exactly one field holding where the police think the player is, and
 * three ways to write it; every test below is either about one of those three
 * or about proving nothing else can.
 */

const HERE = { x: 10, y: 0, z: 10 };
const ELSEWHERE = { x: 90, y: 0, z: 90 };

describe('the crime catalogue', () => {
  it('validates every entry', () => {
    for (const def of CRIMES) {
      const r = validateCrime(def);
      expect(r.errors, `${def.id}: ${r.errors.join('; ')}`).toEqual([]);
    }
  });

  it('gives every crime a fine, so there is always a way to settle it', () => {
    // The non-lethal route through every encounter starts here: if a crime had
    // no price, the only resolution left would be arrest.
    for (const def of CRIMES) expect(def.fine, def.id).toBeGreaterThan(0);
  });

  it('reserves instant maximum heat for the two the police witness themselves', () => {
    const immediate = CRIMES.filter((c) => c.immediateHeat !== null).map((c) => c.id);
    expect(immediate.sort()).toEqual(['attack_police', 'escape_arrest']);
  });

  it('scales severity the way the fiction does', () => {
    const shoplift = crimeDef('shoplifting')!;
    const car = crimeDef('vehicle_theft')!;
    const shot = crimeDef('weapon_discharge')!;
    expect(shoplift.severity).toBeLessThan(car.severity);
    expect(car.severity).toBeLessThan(shot.severity);
  });
});

describe('a crime nobody saw', () => {
  let heat: HeatSystem;
  beforeEach(() => {
    heat = new HeatSystem();
  });

  it('raises no heat at all', () => {
    // The whole of criterion 2 in one assertion. Trespass leaves nothing
    // behind, so an unwitnessed one simply never happened as far as anyone
    // else is concerned.
    heat.commit('trespass', HERE);
    heat.advance(60, []);
    expect(heat.heat).toBe(0);
    expect(heat.level).toBe(0);
    expect(heat.belief).toBeNull();
  });

  it('leaves evidence for the crimes that should, and none for the ones that should not', () => {
    const quiet = new HeatSystem();
    quiet.commit('trespass', HERE);
    expect(quiet.evidence).toHaveLength(0);

    const loud = new HeatSystem();
    loud.commit('vehicle_theft', HERE);
    expect(loud.evidence).toHaveLength(1);
  });

  it('is still never found if no officer goes near the evidence', () => {
    heat.commit('vehicle_theft', HERE);
    // Officers exist, but a long way away.
    for (let i = 0; i < 60; i++) heat.advance(1, [ELSEWHERE]);
    expect(heat.heat).toBe(0);
    expect(heat.belief).toBeNull();
  });

  it('is worked out when an officer walks onto the scene', () => {
    heat.commit('vehicle_theft', HERE);
    heat.advance(1, [{ x: 12, y: 0, z: 10 }]);

    expect(heat.heat).toBeGreaterThan(0);
    expect(heat.belief?.source).toBe('evidence');
    // Evidence says a thing happened *here*, not where the player went.
    expect(heat.belief?.at).toEqual(HERE);
  });

  it('lets evidence go cold, after which the scene is gone', () => {
    heat.commit('assault', HERE);
    const life = crimeDef('assault')!.evidenceSeconds;
    heat.advance(life + 1, [ELSEWHERE]);
    expect(heat.evidence).toHaveLength(0);

    heat.advance(1, [HERE]);
    expect(heat.heat).toBe(0);
  });
});

describe('witness reports', () => {
  let heat: HeatSystem;
  let eventId: number;
  beforeEach(() => {
    heat = new HeatSystem();
    eventId = heat.commit('theft', HERE);
  });

  const report = (over: Partial<Parameters<HeatSystem['report']>[0]> = {}) =>
    heat.report({
      eventId,
      crime: 'theft',
      at: HERE,
      observerId: 'v_gita',
      confidence: 0.8,
      identified: true,
      distanceToHelp: 10,
      canReachHelp: true,
      ...over,
    });

  it('takes time to arrive, and raises nothing until it does', () => {
    // `distanceToHelp: 0` so the delay is exactly `CALL_DELAY_NEAR`. The
    // default of 10 metres puts it at six seconds, which is what the first
    // draft of this test tripped over.
    report({ distanceToHelp: 0 });
    expect(heat.heat).toBe(0);

    heat.advance(CALL_DELAY_NEAR - 1, []);
    expect(heat.heat).toBe(0);

    heat.advance(2, []);
    expect(heat.heat).toBeGreaterThan(0);
  });

  it('takes longer from further away', () => {
    const near = report({ distanceToHelp: 0 })!;
    const far = report({ distanceToHelp: 60 })!;
    expect(near.secondsLeft).toBeCloseTo(CALL_DELAY_NEAR, 2);
    expect(far.secondsLeft).toBeCloseTo(CALL_DELAY_FAR, 2);
  });

  it('is dropped entirely when the witness cannot reach help', () => {
    expect(report({ canReachHelp: false })).toBeNull();
    heat.advance(60, []);
    expect(heat.heat).toBe(0);
    expect(heat.reportsDropped).toBe(1);
  });

  it('is dropped when the witness was too unsure to be worth anyone’s time', () => {
    expect(report({ confidence: 0.05 })).toBeNull();
    heat.advance(60, []);
    expect(heat.heat).toBe(0);
  });

  it('scales with how well the witness saw it', () => {
    const sure = new HeatSystem();
    const sureEvent = sure.commit('theft', HERE);
    sure.report({
      eventId: sureEvent, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    sure.advance(30, []);

    const unsure = new HeatSystem();
    const unsureEvent = unsure.commit('theft', HERE);
    unsure.report({
      eventId: unsureEvent, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 0.3, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    unsure.advance(30, []);

    expect(sure.heat).toBeGreaterThan(unsure.heat);
  });

  it('counts one crime once, however many people phoned', () => {
    // The "false duplicate reports" case. Without this a busy street turns a
    // shoved shopkeeper into a manhunt.
    report({ observerId: 'a' });
    report({ observerId: 'b' });
    report({ observerId: 'c' });
    heat.advance(30, []);

    const once = new HeatSystem();
    const id = once.commit('theft', HERE);
    once.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 0.8, identified: true, distanceToHelp: 10, canReachHelp: true,
    });
    once.advance(30, []);

    expect(heat.heat).toBeCloseTo(once.heat, 5);
    expect(heat.duplicatesIgnored).toBe(2);
  });

  it('raises heat but gives no location when nobody could say who it was', () => {
    // Somebody who heard a bang and saw nothing. This is the distinction that
    // makes hearing worth modelling separately from sight.
    report({ identified: false });
    heat.advance(30, []);
    expect(heat.heat).toBeGreaterThan(0);
    expect(heat.belief).toBeNull();
  });

  it('adds the fine to what is owed', () => {
    report();
    heat.advance(30, []);
    expect(heat.finesOwed).toBe(crimeDef('theft')!.fine);
  });
});

describe('what the police believe', () => {
  it('is never the player’s live position', () => {
    // Structural, and the reason this test reads oddly: there is no way to
    // *give* the system a live position. `advance` takes officers, not the
    // player. If that ever changes, this test stops compiling, which is the
    // strongest guard available.
    const heat = new HeatSystem();
    const id = heat.commit('theft', HERE);
    heat.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 0.9, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    heat.advance(30, []);

    // The player has long since walked to ELSEWHERE; the belief stays put.
    expect(heat.belief?.at).toEqual(HERE);
    heat.advance(5, []);
    expect(heat.belief?.at).toEqual(HERE);
  });

  it('is refreshed only while an officer actually has eyes on', () => {
    const heat = new HeatSystem();
    heat.forceHeat(3, HERE);
    heat.advance(10, []);
    expect(heat.belief!.age).toBeCloseTo(10, 1);

    heat.officerSees(ELSEWHERE);
    expect(heat.belief!.age).toBe(0);
    expect(heat.belief!.at).toEqual(ELSEWHERE);
  });

  it('goes stale once nobody has seen anything for a while', () => {
    const heat = new HeatSystem();
    heat.forceHeat(3, HERE);
    expect(heat.beliefStale).toBe(false);
    heat.advance(BELIEF_STALE_SECONDS + 1, []);
    expect(heat.beliefStale).toBe(true);
  });

  it('cannot be refreshed by an officer while heat is zero', () => {
    const heat = new HeatSystem();
    heat.officerSees(HERE);
    expect(heat.belief).toBeNull();
  });
});

describe('escalation and decay', () => {
  it('holds while the trail is warm and falls once it is cold', () => {
    const heat = new HeatSystem();
    heat.forceHeat(3, HERE);

    // Warm: an officer saw them a moment ago, so nothing decays.
    heat.advance(BELIEF_STALE_SECONDS - 2, []);
    expect(heat.heat).toBeCloseTo(3, 5);

    // Cold: now it drains.
    heat.advance(10, []);
    expect(heat.heat).toBeLessThan(3);
  });

  it('decays at the documented rate', () => {
    const heat = new HeatSystem();
    heat.forceHeat(3, null);
    heat.advance(10, []);
    expect(heat.heat).toBeCloseTo(3 - HEAT_DECAY_PER_SECOND * 10, 4);
  });

  it('lets a player hide until it is gone, and forgets the trail with it', () => {
    const heat = new HeatSystem();
    heat.forceHeat(2, HERE);
    for (let i = 0; i < 120; i++) heat.advance(1, []);
    expect(heat.heat).toBe(0);
    expect(heat.wanted).toBe(false);
    expect(heat.belief).toBeNull();
  });

  it('never exceeds five', () => {
    const heat = new HeatSystem();
    for (let i = 0; i < 10; i++) {
      const id = heat.commit('weapon_discharge', HERE);
      heat.report({
        eventId: id, crime: 'weapon_discharge', at: HERE, observerId: `w${i}`,
        confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
      });
      heat.advance(30, []);
    }
    expect(heat.heat).toBeLessThanOrEqual(MAX_HEAT);
    expect(heat.level).toBe(MAX_HEAT);
  });

  it('jumps straight to the top when an officer is attacked', () => {
    const heat = new HeatSystem();
    heat.commit('attack_police', HERE);
    expect(heat.heat).toBe(5);
    expect(heat.belief?.at).toEqual(HERE);
  });

  it('rounds any heat at all up to at least one on the readout', () => {
    const heat = new HeatSystem();
    heat.forceHeat(0.2, null);
    expect(heat.level).toBe(1);
  });
});

describe('settling', () => {
  it('clears heat, trail and evidence on arrest', () => {
    const heat = new HeatSystem();
    heat.commit('assault', HERE);
    heat.forceHeat(4, HERE);

    heat.settle({ clearFines: false, arrested: true });
    expect(heat.heat).toBe(0);
    expect(heat.belief).toBeNull();
    expect(heat.evidence).toHaveLength(0);
    expect(heat.arrests).toBe(1);
  });

  it('keeps the fine when the arrest did not settle it', () => {
    const heat = new HeatSystem();
    const id = heat.commit('theft', HERE);
    heat.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    heat.advance(30, []);
    const owed = heat.finesOwed;

    heat.settle({ clearFines: false, arrested: true });
    expect(heat.finesOwed).toBe(owed);
  });

  it('pays fines down and never below zero', () => {
    const heat = new HeatSystem();
    const id = heat.commit('theft', HERE);
    heat.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    heat.advance(30, []);

    const owed = heat.finesOwed;
    expect(heat.payFines(owed + 500)).toBe(owed);
    expect(heat.finesOwed).toBe(0);
  });
});

describe('save and load', () => {
  it('round-trips heat, belief, fines, record and arrests', () => {
    const heat = new HeatSystem();
    heat.commit('vehicle_theft', HERE);
    heat.forceHeat(2.5, HERE);
    heat.settle({ clearFines: false, arrested: true });
    heat.commit('assault', ELSEWHERE);
    heat.forceHeat(1.5, ELSEWHERE);

    const other = new HeatSystem();
    other.restore(JSON.parse(JSON.stringify(heat.toJSON())));

    expect(other.heat).toBeCloseTo(1.5, 5);
    expect(other.belief?.at).toEqual(ELSEWHERE);
    expect(other.arrests).toBe(1);
    expect(other.record.map((r) => r.crime)).toEqual(['vehicle_theft', 'assault']);
  });

  it('does not restore witness calls that were still in flight', () => {
    // A report in flight is somebody walking to a phone box, and that person
    // is not in the save either. Restoring the call without the caller is the
    // police learning something from nobody.
    const heat = new HeatSystem();
    const id = heat.commit('theft', HERE);
    heat.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 1, identified: true, distanceToHelp: 40, canReachHelp: true,
    });
    expect(heat.pendingReports).toHaveLength(1);

    const other = new HeatSystem();
    other.restore(heat.toJSON());
    other.advance(60, []);

    expect(other.pendingReports).toHaveLength(0);
    expect(other.heat).toBe(0);
  });

  it('cannot re-score a crime that already landed', () => {
    const heat = new HeatSystem();
    const id = heat.commit('theft', HERE);
    heat.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'a',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    heat.advance(30, []);
    const scored = heat.heat;

    const other = new HeatSystem();
    other.restore(heat.toJSON());
    // The same event reported again after the reload must add nothing.
    other.report({
      eventId: id, crime: 'theft', at: HERE, observerId: 'b',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    other.advance(30, []);

    expect(other.heat).toBeCloseTo(scored, 5);
  });

  it('restores an absent block as a clean record', () => {
    const heat = new HeatSystem();
    heat.forceHeat(4, HERE);
    heat.restore(undefined);
    expect(heat.heat).toBe(0);
    expect(heat.belief).toBeNull();
    expect(heat.finesOwed).toBe(0);
  });

  it('does not reuse an event id after a reload', () => {
    const heat = new HeatSystem();
    const a = heat.commit('theft', HERE);
    heat.report({
      eventId: a, crime: 'theft', at: HERE, observerId: 'x',
      confidence: 1, identified: true, distanceToHelp: 0, canReachHelp: true,
    });
    heat.advance(30, []);

    const other = new HeatSystem();
    other.restore(heat.toJSON());
    expect(other.newEventId()).toBeGreaterThan(a);
  });
});
