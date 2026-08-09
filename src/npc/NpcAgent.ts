import * as THREE from 'three';
import type { AgentHandle } from '../nav/Navigation';
import type { NavService } from '../nav/NavService';
import type { Vec3Like } from '../nav/NavTypes';
import type { NamedNpcDefinition, NpcAppearance } from './NpcDefinition';
import type { NpcBody, NpcVisuals } from './NpcVisuals';
import type { ActivityKind, AnchorSlot, ScheduleDefinition } from './ScheduleDefinition';
import { resolveActivity } from './ScheduleDefinition';
import type { LodBand } from './NpcLod';
import type { ReactionKind } from './Perception';

/**
 * One simulated person, at whichever tier they currently deserve.
 *
 * The same class covers a named resident and an ambient pedestrian because the
 * *movement* is identical — walk to a place, arrive, wait, walk somewhere else.
 * What differs is who decides the place: a named resident asks their schedule,
 * a pedestrian picks the next wander point. That difference is two branches,
 * not two classes, and keeping it that way means stuck recovery and LOD
 * transitions are written once.
 */

export type AgentKind = 'named' | 'ambient';

export interface AgentDeps {
  readonly nav: NavService;
  /** Null when the shared rig failed to load; agents simulate without bodies. */
  readonly visuals: NpcVisuals | null;
  readonly group: THREE.Group;
  heightAt(x: number, z: number): number;
}

/** Walking speeds, metres per second. Slower than the player's 1.24 m walk. */
const SPEED: Record<'stroll' | 'walk' | 'hurry', number> = {
  stroll: 1.05,
  walk: 1.3,
  hurry: 1.7,
};

/** Below this, an agent that wants to be moving is considered stuck. */
const STUCK_SPEED = 0.09;
/** Seconds of not moving before recovery kicks in. */
const STUCK_PATIENCE = 3.0;
/** Re-pathing attempts before the agent is simply placed at its destination. */
const STUCK_RETRIES = 2;
/** How close counts as arrived. */
const ARRIVE_RADIUS = 1.4;

/** How long a greeting or a startled look holds before routine resumes. */
const REACTION_HOLD = 2.6;

export interface AgentStats {
  readonly stuckRecoveries: number;
  readonly repaths: number;
  readonly teleports: number;
}

export class NpcAgent {
  readonly position = new THREE.Vector3();
  facing = 0;

  band: LodBand = 'far';
  /** Inside a building: simulated, not drawn, not perceivable. */
  indoors = false;
  activity: ActivityKind = 'home';
  /** Set by a quest to override the schedule until cleared. */
  questOverride: { kind: ActivityKind; place: Vec3Like } | null = null;
  reaction: ReactionKind | null = null;

  /** Age, advanced by the player's birthdays. Named residents only. */
  age: number;

  private destination: THREE.Vector3 | null = null;
  private corners: Vec3Like[] = [];
  private cornerIndex = 0;
  private navAgent: AgentHandle | null = null;
  private body: NpcBody | null = null;
  private speed = SPEED.walk;
  /** Smoothed planar speed, for choosing a clip and for stuck detection. */
  private observedSpeed = 0;
  private stuckTimer = 0;
  private stuckRetries = 0;
  private reactionTimer = 0;
  private waitTimer = 0;
  private lastClip = '';

  private recoveries = 0;
  private repathCount = 0;
  private teleportCount = 0;

  private readonly previous = new THREE.Vector3();
  private readonly scratch = new THREE.Vector3();

  constructor(
    readonly id: string,
    readonly kind: AgentKind,
    readonly definition: NamedNpcDefinition | null,
    public appearance: NpcAppearance,
    private readonly schedule: ScheduleDefinition | null,
    private readonly deps: AgentDeps,
  ) {
    this.age = definition?.startAge ?? 30;
  }

  get stats(): AgentStats {
    return {
      stuckRecoveries: this.recoveries,
      repaths: this.repathCount,
      teleports: this.teleportCount,
    };
  }

  get hasBody(): boolean {
    return this.body !== null;
  }

  get target(): THREE.Vector3 | null {
    return this.destination;
  }

  get movingSpeed(): number {
    return this.observedSpeed;
  }

  /** Place the agent, without pathing. Used on spawn and by recovery. */
  placeAt(x: number, z: number): void {
    const y = this.deps.heightAt(x, z);
    this.position.set(x, y, z);
    this.previous.copy(this.position);
    this.navAgent?.teleport(this.position);
    if (this.body) this.body.root.position.copy(this.position);
  }

  // ------------------------------------------------------------- schedule

  /**
   * Re-read the schedule and, if the answer changed, head somewhere new.
   *
   * Called by the far tick rather than every frame. Returns true when the
   * activity actually changed, which is what the far tier uses to decide
   * whether anything needs doing.
   */
  applySchedule(hour: number): boolean {
    const override = this.questOverride;
    if (override) {
      const changed = this.activity !== override.kind;
      this.activity = override.kind;
      this.setDestination(override.place.x, override.place.z);
      this.indoors = false;
      return changed;
    }

    if (!this.schedule || !this.definition) return false;

    const block = resolveActivity(this.schedule, hour);
    const changed = block.kind !== this.activity;
    this.activity = block.kind;

    const anchor = this.definition.anchors[block.place as AnchorSlot];
    if (anchor) this.setDestination(anchor.x, anchor.z);

    // Sleeping is the one activity that takes somebody out of the world. It is
    // also what keeps a doorway clear overnight: an NPC who has arrived home to
    // sleep is inside, not standing on the step.
    const home = this.definition.anchors.home;
    const atHome = Math.hypot(this.position.x - home.x, this.position.z - home.z) < 3.5;
    this.indoors = block.kind === 'sleep' && atHome;

    this.speed = block.kind === 'commute' ? SPEED.walk : SPEED.stroll;
    return changed;
  }

  /** Send the agent somewhere. Recomputes the coarse path immediately. */
  setDestination(x: number, z: number): void {
    if (this.destination && Math.hypot(this.destination.x - x, this.destination.z - z) < 0.5) {
      return;
    }
    this.destination = new THREE.Vector3(x, this.deps.heightAt(x, z), z);
    this.repath();
    this.navAgent?.setTarget(this.destination);
    this.waitTimer = 0;
  }

  clearDestination(): void {
    this.destination = null;
    this.corners = [];
    this.cornerIndex = 0;
  }

  private repath(): void {
    if (!this.destination) return;
    this.corners = this.deps.nav.path(this.position, this.destination);
    // The first corner is where we already are.
    this.cornerIndex = this.corners.length > 1 ? 1 : 0;
    this.repathCount++;
  }

  get arrived(): boolean {
    if (!this.destination) return true;
    return (
      Math.hypot(this.destination.x - this.position.x, this.destination.z - this.position.z) <=
      ARRIVE_RADIUS
    );
  }

  // ------------------------------------------------------------------ LOD

  /**
   * Move to a new tier.
   *
   * The crowd agent and the body are the two things that cost something, and
   * both are acquired and released here rather than anywhere else, so there is
   * exactly one place where a leak could be.
   */
  setBand(band: LodBand): void {
    if (band === this.band) return;
    const previous = this.band;
    this.band = band;

    if (band === 'near' && previous !== 'near') this.attachNavAgent();
    if (band !== 'near' && previous === 'near') this.detachNavAgent();

    const wantsBody = band !== 'far' && !this.indoors;
    if (wantsBody && !this.body) this.attachBody();
    if (!wantsBody && this.body) this.detachBody();
  }

  private attachNavAgent(): void {
    if (this.navAgent) return;
    this.navAgent = this.deps.nav.addAgent(this.position, { maxSpeed: this.speed });
    if (this.navAgent && this.destination) this.navAgent.setTarget(this.destination);
  }

  private detachNavAgent(): void {
    if (!this.navAgent) return;
    this.deps.nav.removeAgent(this.navAgent);
    this.navAgent = null;
    // Coarse movement resumes from wherever the crowd left us, so the path has
    // to be rebuilt from here rather than from where the path was planned.
    this.repath();
  }

  private attachBody(): void {
    const visuals = this.deps.visuals;
    if (!visuals) return;
    this.body = visuals.acquire(this.appearance);
    this.body.root.position.copy(this.position);
    this.body.root.rotation.y = this.facing;
    this.deps.group.add(this.body.root);
    this.lastClip = '';
  }

  private detachBody(): void {
    if (!this.body) return;
    this.deps.visuals?.release(this.body);
    this.body = null;
  }

  // --------------------------------------------------------------- update

  /**
   * One frame.
   *
   * `dt` is the simulation step for near and mid; the far tier calls this too,
   * but with a much larger `dt` and a much lower frequency, which is why the
   * coarse mover integrates rather than lerping toward a fixed fraction.
   */
  update(dt: number): void {
    if (this.reactionTimer > 0) {
      this.reactionTimer -= dt;
      if (this.reactionTimer <= 0) this.reaction = null;
    }

    this.previous.copy(this.position);

    if (this.indoors) {
      this.observedSpeed = 0;
      if (this.body) this.detachBody();
      return;
    }

    if (this.band === 'near' && this.navAgent) this.followCrowd();
    else this.followCorners(dt);

    // Measured rather than assumed: the crowd may have refused to move us, and
    // that is exactly what stuck detection needs to see.
    const moved = Math.hypot(
      this.position.x - this.previous.x,
      this.position.z - this.previous.z,
    );
    this.observedSpeed = dt > 0 ? moved / dt : 0;

    this.updateStuck(dt);
    this.updateBody(dt);
  }

  private followCrowd(): void {
    const agent = this.navAgent;
    if (!agent) return;
    const p = agent.position;
    this.position.set(p.x, p.y, p.z);
    const v = agent.velocity;
    if (Math.hypot(v.x, v.z) > 0.05) this.facing = Math.atan2(v.x, v.z);
  }

  /**
   * Coarse movement: walk the corner list, no avoidance.
   *
   * Corners come from a navmesh query, so this does not walk through walls
   * even though it is not steering around anything. That distinction matters —
   * mid-tier NPCs are visible from across a district, and one clipping through
   * a house is far more noticeable than one that fails to sidestep a bin.
   */
  private followCorners(dt: number): void {
    if (!this.destination) {
      this.observedSpeed = 0;
      return;
    }
    if (this.arrived) {
      this.waitTimer += dt;
      return;
    }

    const goal = this.corners[this.cornerIndex] ?? this.destination;
    const dx = goal.x - this.position.x;
    const dz = goal.z - this.position.z;
    const distance = Math.hypot(dx, dz);

    if (distance < 0.5) {
      if (this.cornerIndex < this.corners.length - 1) this.cornerIndex++;
      return;
    }

    const step = Math.min(this.speed * dt, distance);
    this.position.x += (dx / distance) * step;
    this.position.z += (dz / distance) * step;
    this.position.y = this.deps.heightAt(this.position.x, this.position.z);
    this.facing = Math.atan2(dx, dz);
  }

  /**
   * Notice not moving, and do something about it.
   *
   * Three escalating answers, because the causes are different. A crowd agent
   * wedged behind another agent clears if asked again. A path that has gone
   * stale — the destination changed, or a chunk streamed in underneath —
   * clears with a fresh query. Neither of those helps an agent standing
   * somewhere the navmesh does not reach, so the last resort is to place them
   * at the destination, which is ugly and rare and much better than a resident
   * who never arrives anywhere again.
   */
  private updateStuck(dt: number): void {
    const wantsToMove = this.destination !== null && !this.arrived;
    if (!wantsToMove || this.observedSpeed > STUCK_SPEED) {
      this.stuckTimer = 0;
      if (this.observedSpeed > STUCK_SPEED) this.stuckRetries = 0;
      return;
    }

    this.stuckTimer += dt;
    if (this.stuckTimer < STUCK_PATIENCE) return;

    this.stuckTimer = 0;
    this.recoveries++;

    if (this.stuckRetries < STUCK_RETRIES) {
      this.stuckRetries++;
      this.repath();
      if (this.destination) this.navAgent?.setTarget(this.destination);
      return;
    }

    this.stuckRetries = 0;
    const goal = this.destination;
    if (!goal) return;
    const snapped = this.deps.nav.sample(goal) ?? { x: goal.x, y: goal.y, z: goal.z };
    this.placeAt(snapped.x, snapped.z);
    this.teleportCount++;
    this.repath();
  }

  private updateBody(dt: number): void {
    const body = this.body;
    if (!body) return;

    body.root.position.copy(this.position);
    // Ease the turn rather than snapping it; a pedestrian that rotates
    // instantly reads as a sprite, not a person.
    const delta = shortestAngle(this.facing - body.root.rotation.y);
    body.root.rotation.y += delta * Math.min(1, dt * 9);

    const clip = this.chooseClip();
    if (clip !== this.lastClip) {
      body.play(clip, clip === 'Wave' ? 0.12 : 0.22);
      this.lastClip = clip;
    }
    // Mid tier animates too, just less often; the caller passes a coarser dt.
    body.mixer.update(dt);
  }

  private chooseClip(): string {
    if (this.reaction === 'greet') return 'Wave';
    if (this.reaction === 'flee') return 'Run';
    if (this.activity === 'sleep') return 'Sit';
    if (this.observedSpeed > 1.55) return 'Run';
    if (this.observedSpeed > 0.15) return 'Walk';
    return 'Idle';
  }

  // ------------------------------------------------------------ reactions

  /**
   * React to something noticed.
   *
   * Reactions are transient and never stack: a second thing happening replaces
   * the first, which is both cheaper and closer to how a startled person
   * behaves than a queue of pending emotions.
   */
  react(kind: ReactionKind, away: Vec3Like | null): void {
    if (kind === 'resume') return;
    this.reaction = kind;
    this.reactionTimer = REACTION_HOLD;

    if (kind === 'flee' && away) {
      const dx = this.position.x - away.x;
      const dz = this.position.z - away.z;
      const len = Math.hypot(dx, dz) || 1;
      this.speed = SPEED.hurry;
      this.navAgent?.setMaxSpeed(SPEED.hurry);
      this.setDestination(this.position.x + (dx / len) * 18, this.position.z + (dz / len) * 18);
      return;
    }

    if (kind === 'step_aside' && away) {
      // Sidestep, not retreat: perpendicular to whatever is coming.
      const dx = this.position.x - away.x;
      const dz = this.position.z - away.z;
      const len = Math.hypot(dx, dz) || 1;
      this.scratch.set(-dz / len, 0, dx / len).multiplyScalar(2.2);
      this.setDestination(this.position.x + this.scratch.x, this.position.z + this.scratch.z);
      return;
    }

    if ((kind === 'greet' || kind === 'watch') && away) {
      this.facing = Math.atan2(away.x - this.position.x, away.z - this.position.z);
    }
  }

  /** Seconds spent standing at the destination, for wander decisions. */
  get waiting(): number {
    return this.waitTimer;
  }

  resetWait(): void {
    this.waitTimer = 0;
  }

  /** A birthday. Named residents age with the player. */
  advanceAge(years = 1): void {
    this.age += years;
  }

  dispose(): void {
    this.detachNavAgent();
    this.detachBody();
    this.destination = null;
    this.corners = [];
  }
}

export function shortestAngle(a: number): number {
  let d = a % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d <= -Math.PI) d += Math.PI * 2;
  return d;
}
