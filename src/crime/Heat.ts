import { MAX_HEAT, crimeDef, type CrimeId } from './CrimeDefinition';
import type { Vec3Like } from '../nav/NavTypes';

/**
 * How much the police know, and how they came to know it.
 *
 * **Acceptance criterion 2 is a structural property of this file, not a
 * promise made about it.** There is exactly one private field holding where
 * the police think the player is — `belief` — and exactly three methods that
 * may write to it:
 *
 * 1. `officerSaw`   — an officer perceived the player directly, right now.
 * 2. `deliverReport`— a witness who *identified* them got through to help.
 * 3. `findEvidence` — an officer walked onto a scene and worked it out.
 *
 * Nothing else can. The player's live position is not a parameter of this
 * class at all; `advance` takes it only to age evidence and to decide whether
 * a *known* belief has gone stale. Grep for `belief =` and there are three
 * hits, which is the whole argument.
 *
 * Everything is pure and clockless. Seconds arrive through `advance(dt)`.
 */

export interface HeatBelief {
  /** Where the police think the player is. Never where they are. */
  readonly at: Vec3Like;
  /** Seconds since this was last confirmed by sight. */
  readonly age: number;
  /** How the police came to believe it. Shown in the debug overlay. */
  readonly source: 'sight' | 'witness' | 'evidence';
}

export interface PendingReport {
  readonly id: number;
  readonly eventId: number;
  readonly crime: CrimeId;
  readonly at: Vec3Like;
  readonly observerId: string;
  /** 0..1, straight from `Perception`. */
  readonly confidence: number;
  /** Seconds until it reaches the station. */
  secondsLeft: number;
  /** Did they see well enough to say who it was? */
  readonly identified: boolean;
}

export interface EvidenceItem {
  readonly id: number;
  readonly eventId: number;
  readonly crime: CrimeId;
  readonly at: Vec3Like;
  secondsLeft: number;
  found: boolean;
}

export interface HeatSaveData {
  heat: number;
  belief: { x: number; y: number; z: number; age: number; source: string } | null;
  /** Crimes already counted, so a reload cannot double-count one. */
  countedEvents: number[];
  evidence: Array<{ eventId: number; crime: string; x: number; y: number; z: number; secondsLeft: number }>;
  /** Unpaid fines, in whole dollars. */
  finesOwed: number;
  /** Every offence the record remembers, most recent last. */
  record: Array<{ crime: string; heat: number }>;
  arrests: number;
}

/** How long a witness takes to find help, by how far they had to go. */
export const CALL_DELAY_NEAR = 4;
export const CALL_DELAY_FAR = 16;

/**
 * Heat falls this fast once nobody has seen you and nothing is being searched.
 *
 * 0.11 per second is roughly nine seconds a star, so hiding from a level 3
 * takes about half a minute of not being found — long enough to be a decision,
 * short enough that a mistake is not a punishment.
 */
export const HEAT_DECAY_PER_SECOND = 0.11;

/** Seconds of not being seen before a belief is treated as stale. */
export const BELIEF_STALE_SECONDS = 22;

/** How close an officer has to get to a scene to work out what happened. */
export const EVIDENCE_FIND_RADIUS = 6;

export class HeatSystem {
  private heatValue = 0;
  private beliefValue: HeatBelief | null = null;

  private readonly pending: PendingReport[] = [];
  private readonly evidenceItems: EvidenceItem[] = [];
  /** Crime events already scored. Kept so N witnesses are still one crime. */
  private readonly counted = new Set<number>();

  private nextId = 1;
  private nextEventId = 1;

  private finesOwedValue = 0;
  private readonly recordItems: Array<{ crime: CrimeId; heat: number }> = [];
  arrests = 0;

  /** Rolling counts for the debug overlay and for tests. */
  reportsDelivered = 0;
  reportsDropped = 0;
  duplicatesIgnored = 0;

  // -- reading -------------------------------------------------------------

  get heat(): number {
    return this.heatValue;
  }

  /** 0..5, for the HUD. Rounded up, so any Heat at all shows as at least 1. */
  get level(): number {
    return this.heatValue <= 0 ? 0 : Math.min(MAX_HEAT, Math.ceil(this.heatValue));
  }

  get wanted(): boolean {
    return this.heatValue > 0;
  }

  /** What the police believe. Null means they have nothing to go on. */
  get belief(): HeatBelief | null {
    return this.beliefValue;
  }

  get beliefStale(): boolean {
    return this.beliefValue !== null && this.beliefValue.age >= BELIEF_STALE_SECONDS;
  }

  get finesOwed(): number {
    return this.finesOwedValue;
  }

  get record(): readonly { crime: CrimeId; heat: number }[] {
    return this.recordItems;
  }

  get pendingReports(): readonly PendingReport[] {
    return this.pending;
  }

  get evidence(): readonly EvidenceItem[] {
    return this.evidenceItems;
  }

  /** A fresh id for one crime, however many people saw it. */
  newEventId(): number {
    return this.nextEventId++;
  }

  // -- committing ----------------------------------------------------------

  /**
   * Record that a crime happened, and leave whatever it leaves.
   *
   * **This raises no Heat by itself.** It creates the *possibility* of being
   * caught — evidence at a place, and an event id that witnesses can report
   * against. A crime nobody saw, that leaves nothing, ends here and the police
   * never learn of it. That is the point.
   */
  commit(crime: CrimeId, at: Vec3Like): number {
    const def = crimeDef(crime);
    if (!def) return 0;

    const eventId = this.newEventId();
    this.recordItems.push({ crime, heat: this.heatValue });

    if (def.evidence !== 'none' && def.evidenceSeconds > 0) {
      this.evidenceItems.push({
        id: this.nextId++,
        eventId,
        crime,
        at: { x: at.x, y: at.y, z: at.z },
        secondsLeft: def.evidenceSeconds,
        found: false,
      });
    }

    // The two that every officer hears about at once, because the officer
    // involved is the one making the call.
    if (def.immediateHeat !== null) {
      this.raise(def.immediateHeat, eventId);
      this.setBelief(at, 'witness');
    }
    return eventId;
  }

  /**
   * A witness saw something and is going for help.
   *
   * Queued with a delay rather than applied: somebody has to actually get
   * somewhere before the police know, and that gap is the player's chance to
   * leave. A witness who cannot reach help never delivers at all.
   */
  report(opts: {
    eventId: number;
    crime: CrimeId;
    at: Vec3Like;
    observerId: string;
    confidence: number;
    identified: boolean;
    distanceToHelp: number;
    canReachHelp: boolean;
  }): PendingReport | null {
    if (!crimeDef(opts.crime)) return null;
    if (!opts.canReachHelp) {
      this.reportsDropped++;
      return null;
    }
    // Too unsure to be worth anyone's time. Mirrors `chooseReaction`'s floor.
    if (opts.confidence < 0.12) {
      this.reportsDropped++;
      return null;
    }

    const t = Math.max(0, Math.min(1, opts.distanceToHelp / 60));
    const report: PendingReport = {
      id: this.nextId++,
      eventId: opts.eventId,
      crime: opts.crime,
      at: { x: opts.at.x, y: opts.at.y, z: opts.at.z },
      observerId: opts.observerId,
      confidence: opts.confidence,
      secondsLeft: CALL_DELAY_NEAR + (CALL_DELAY_FAR - CALL_DELAY_NEAR) * t,
      identified: opts.identified,
    };
    this.pending.push(report);
    return report;
  }

  /**
   * An officer saw it happen. No delay, no witness, no doubt.
   *
   * The only path that both scores a crime and fixes a belief in the same
   * instant, because it is the only one where the person who knows is also
   * the person who acts.
   */
  officerSaw(crime: CrimeId, at: Vec3Like, eventId: number): void {
    const def = crimeDef(crime);
    if (!def) return;
    this.raise(def.severity, eventId);
    this.setBelief(at, 'sight');
  }

  /** An officer has eyes on the player right now. Refreshes the belief. */
  officerSees(at: Vec3Like): void {
    if (this.heatValue <= 0) return;
    this.setBelief(at, 'sight');
  }

  // -- the frame -----------------------------------------------------------

  /**
   * Advance delays, evidence and decay.
   *
   * `officerPositions` are where officers are *now*, used only to decide
   * whether one has walked close enough to a scene to find it. The player's
   * position is deliberately not a parameter: nothing here may learn it.
   */
  advance(dt: number, officerPositions: readonly Vec3Like[]): void {
    if (!Number.isFinite(dt) || dt <= 0) return;
    this.beliefTouched = false;
    this.heatRaised = false;

    // -- witness calls landing --------------------------------------------
    for (let i = this.pending.length - 1; i >= 0; i--) {
      const r = this.pending[i];
      r.secondsLeft -= dt;
      if (r.secondsLeft > 0) continue;
      this.pending.splice(i, 1);
      this.deliverReport(r);
    }

    // -- evidence ageing, and officers walking onto it ---------------------
    for (let i = this.evidenceItems.length - 1; i >= 0; i--) {
      const e = this.evidenceItems[i];
      e.secondsLeft -= dt;
      if (e.secondsLeft <= 0) {
        this.evidenceItems.splice(i, 1);
        continue;
      }
      if (e.found) continue;
      for (const p of officerPositions) {
        const dx = p.x - e.at.x;
        const dz = p.z - e.at.z;
        if (dx * dx + dz * dz <= EVIDENCE_FIND_RADIUS * EVIDENCE_FIND_RADIUS) {
          this.findEvidence(e);
          break;
        }
      }
    }

    // -- belief ageing and decay ------------------------------------------
    //
    // A belief written *during* this tick is not aged by this tick's dt. With
    // a 1/60 s frame that is invisible; with the large steps a test uses it is
    // the difference between working and not. A single `advance(30)` that
    // delivered a witness call would otherwise immediately apply thirty
    // seconds of decay to the Heat it had just raised, and wipe it — which is
    // exactly what five tests found on the first run.
    if (this.beliefValue && !this.beliefTouched) {
      this.beliefValue = { ...this.beliefValue, age: this.beliefValue.age + dt };
    }

    // Heat only falls once the trail has gone cold, and never in the same tick
    // it rose. The second half is the symmetric partner of the belief rule
    // above: a report landing part-way through a tick must not then be charged
    // that whole tick's decay, or a witness call with no identification is
    // wiped by the very step that delivered it.
    const cold =
      !this.beliefTouched &&
      !this.heatRaised &&
      (this.beliefValue === null || this.beliefValue.age >= BELIEF_STALE_SECONDS);
    if (cold && this.heatValue > 0) {
      this.heatValue = Math.max(0, this.heatValue - HEAT_DECAY_PER_SECOND * dt);
      if (this.heatValue === 0) this.beliefValue = null;
    }
  }

  // -- the three writers ---------------------------------------------------

  /**
   * A witness call landed.
   *
   * The duplicate rule lives here: **one crime is one crime however many
   * people phoned about it.** The first report through scores it; the rest are
   * counted and thrown away. Without this, a busy street multiplies a shoved
   * shopkeeper into a manhunt, which is both wrong and the exact failure the
   * brief calls "false duplicate reports".
   */
  private deliverReport(r: PendingReport): void {
    this.reportsDelivered++;

    const def = crimeDef(r.crime);
    if (!def) return;

    if (this.counted.has(r.eventId)) {
      this.duplicatesIgnored++;
      // A duplicate still *confirms* a location if this witness saw who it
      // was and the earlier one did not. It adds no Heat.
      if (r.identified) this.setBelief(r.at, 'witness');
      return;
    }

    this.raise(def.severity * r.confidence, r.eventId);
    this.finesOwedValue += def.fine;

    // Only a witness who could say *who* gives the police somewhere to look.
    // Somebody who heard a bang and saw nothing raises Heat and no more.
    if (r.identified) this.setBelief(r.at, 'witness');
  }

  /** An officer worked out what happened here. */
  private findEvidence(e: EvidenceItem): void {
    e.found = true;
    const def = crimeDef(e.crime);
    if (!def) return;

    if (this.counted.has(e.eventId)) {
      this.duplicatesIgnored++;
      return;
    }
    // Evidence is worth less than an eyewitness: it says a thing happened
    // here, not who did it or where they went.
    this.raise(def.severity * 0.6, e.eventId);
    this.finesOwedValue += def.fine;
    this.setBelief(e.at, 'evidence');
  }

  /** Set during an `advance` in which the belief was written. See `advance`. */
  private beliefTouched = false;

  private setBelief(at: Vec3Like, source: HeatBelief['source']): void {
    this.beliefValue = { at: { x: at.x, y: at.y, z: at.z }, age: 0, source };
    this.beliefTouched = true;
  }

  /** Set during an `advance` in which Heat rose. See `advance`. */
  private heatRaised = false;

  private raise(amount: number, eventId: number): void {
    if (amount <= 0) return;
    this.counted.add(eventId);
    this.heatValue = Math.min(MAX_HEAT, this.heatValue + amount);
    this.heatRaised = true;
  }

  // -- resolution ----------------------------------------------------------

  /**
   * Arrested, or the fine was settled.
   *
   * Clears Heat and the trail outright. Evidence goes too: it has been
   * processed, and leaving it lying about would re-raise Heat the moment an
   * officer walked past the same doorway.
   */
  settle(opts: { clearFines: boolean; arrested: boolean }): void {
    this.heatValue = 0;
    this.beliefValue = null;
    this.pending.length = 0;
    this.evidenceItems.length = 0;
    if (opts.clearFines) this.finesOwedValue = 0;
    if (opts.arrested) this.arrests++;
  }

  /** Pay some of it off at the desk. Returns what was actually cleared. */
  payFines(amount: number): number {
    const paid = Math.max(0, Math.min(this.finesOwedValue, Math.floor(amount)));
    this.finesOwedValue -= paid;
    return paid;
  }

  /** Test and debug only: force a level. Never reachable in ordinary play. */
  forceHeat(value: number, at: Vec3Like | null): void {
    this.heatValue = Math.max(0, Math.min(MAX_HEAT, value));
    if (at) this.setBelief(at, 'sight');
    else if (this.heatValue === 0) this.beliefValue = null;
  }

  // -- persistence ---------------------------------------------------------

  toJSON(): HeatSaveData {
    return {
      heat: this.heatValue,
      belief: this.beliefValue
        ? {
            x: this.beliefValue.at.x,
            y: this.beliefValue.at.y,
            z: this.beliefValue.at.z,
            age: this.beliefValue.age,
            source: this.beliefValue.source,
          }
        : null,
      countedEvents: [...this.counted].sort((a, b) => a - b),
      evidence: this.evidenceItems.map((e) => ({
        eventId: e.eventId,
        crime: e.crime,
        x: e.at.x,
        y: e.at.y,
        z: e.at.z,
        secondsLeft: e.secondsLeft,
      })),
      finesOwed: this.finesOwedValue,
      record: this.recordItems.map((r) => ({ crime: r.crime, heat: r.heat })),
      arrests: this.arrests,
    };
  }

  /**
   * Restore, defensively.
   *
   * **Pending witness calls are deliberately not saved.** A report in flight is
   * somebody walking to a phone box, and the person is not in the save either
   * — restoring the call without the caller would be the police learning
   * something from nobody, which is precisely what criterion 2 forbids. The
   * *counted* set is saved, so a reload cannot re-score a crime that already
   * landed.
   */
  restore(data: Partial<HeatSaveData> | undefined): void {
    this.heatValue = numberOr(data?.heat, 0);
    this.heatValue = Math.max(0, Math.min(MAX_HEAT, this.heatValue));

    const b = data?.belief;
    this.beliefValue =
      b && Number.isFinite(b.x)
        ? {
            at: { x: b.x, y: b.y, z: b.z },
            age: numberOr(b.age, 0),
            source: b.source === 'witness' || b.source === 'evidence' ? b.source : 'sight',
          }
        : null;

    this.counted.clear();
    for (const id of data?.countedEvents ?? []) if (Number.isFinite(id)) this.counted.add(id);

    this.pending.length = 0;
    this.evidenceItems.length = 0;
    for (const e of data?.evidence ?? []) {
      if (!crimeDef(e.crime)) continue;
      this.evidenceItems.push({
        id: this.nextId++,
        eventId: e.eventId,
        crime: e.crime as CrimeId,
        at: { x: e.x, y: e.y, z: e.z },
        secondsLeft: Math.max(0, numberOr(e.secondsLeft, 0)),
        found: false,
      });
    }

    this.finesOwedValue = Math.max(0, Math.floor(numberOr(data?.finesOwed, 0)));
    this.recordItems.length = 0;
    for (const r of data?.record ?? []) {
      if (crimeDef(r.crime)) {
        this.recordItems.push({ crime: r.crime as CrimeId, heat: numberOr(r.heat, 0) });
      }
    }
    this.arrests = Math.max(0, Math.floor(numberOr(data?.arrests, 0)));

    // Event ids must not collide with restored ones.
    this.nextEventId = Math.max(1, ...[...this.counted].map((i) => i + 1));
  }

  reset(): void {
    this.restore(undefined);
    this.reportsDelivered = 0;
    this.reportsDropped = 0;
    this.duplicatesIgnored = 0;
    this.arrests = 0;
  }
}

function numberOr(v: unknown, fallback: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? v : fallback;
}
