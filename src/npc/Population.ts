import * as THREE from 'three';
import type { CollisionWorld } from '../physics/CollisionWorld';
import { NavService } from '../nav/NavService';
import {
  navInputFromGeometry,
  offMeshLinksForZone,
  preferredCrossing,
  type OffMeshLink,
} from '../nav/NavTypes';
import type { ZoneManifest } from '../world/zones/Manifest';
import { NpcAgent, type AgentDeps } from './NpcAgent';
import { NPC_CATALOGUE } from './npcCatalog';
import { npcsInZone, type NamedNpcDefinition } from './NpcDefinition';
import { bandFor, rankForNear, type LodBand, type PopulationBudget } from './NpcLod';
import { ambientAppearance, NpcVisuals } from './NpcVisuals';
import {
  chooseReaction,
  DEFAULT_SENSES,
  PerceptionBus,
  type Observer,
  type PerceptionKind,
  type Witness,
} from './Perception';
import type { RelationshipStore } from './Relationships';
import { pickBark } from './Dialogue';
import { hourOfDay, nextTransition } from './ScheduleDefinition';
import { scheduleById } from './schedules';
import { buildLaneGraph, centrelinesFromManifest, type Centreline } from '../traffic/LaneGraph';
import { TrafficSystem, type TrafficObstacle } from '../traffic/TrafficSystem';
import { mulberry32 } from '../traffic/TrafficRules';

/**
 * The living population of one zone.
 *
 * This is the root of the lazily-imported population chunk: `Game` holds a
 * `Population | null` and a dynamic `import()`, and everything below — the
 * catalogue, the schedules, the crowd, the traffic and the ~900 kB of Recast
 * WebAssembly behind `NavService` — arrives with it. The village stands and is
 * playable before any of it lands.
 *
 * Update order is deliberate and mirrors `Game`'s own:
 *
 *   far schedules -> band assignment -> crowd step -> agents -> traffic
 *   -> perception
 *
 * Perception is last because it reports on where everybody *ended up* this
 * frame. Resolving it first would have witnesses reacting to positions that no
 * longer exist, which is subtle, wrong, and exactly the kind of thing that
 * turns into "the police knew where I was before I got there" in Phase 9.
 */

export interface PopulationDeps {
  readonly zone: ZoneManifest;
  readonly group: THREE.Group;
  readonly collision: CollisionWorld;
  readonly relationships: RelationshipStore;
  /** Shared rig and clips, from the player GLB. */
  readonly rig: { scene: THREE.Object3D | null; clips: readonly THREE.AnimationClip[] };
  readonly vehicleModels: Map<string, THREE.Object3D>;
  heightAt(x: number, z: number): number;
  /** Extra centrelines the zone knows about but the manifest does not. */
  readonly extraCentrelines?: readonly Centreline[];
}

export interface PopulationStats {
  readonly named: number;
  readonly ambient: number;
  readonly near: number;
  readonly mid: number;
  readonly far: number;
  readonly bodies: number;
  readonly navState: string;
  readonly navBuildMs: number;
  readonly navAgents: number;
  readonly offMeshLinks: number;
  readonly traffic: number;
  readonly trafficParked: number;
  readonly trafficBarges: number;
  readonly witnessed: number;
  readonly stuckRecoveries: number;
  /** Milliseconds the last far tick took. Bounded by `farPerTick`. */
  readonly farTickMs: number;
}

/** Far schedules are re-examined at this rate, not per frame. */
const FAR_TICK_SECONDS = 0.5;
/** Perception resolves at this rate. Twice a second is enough to react to. */
const PERCEPTION_TICK_SECONDS = 0.5;
/** Mid-tier animation is stepped at this rate, not per frame. */
const MID_ANIM_HZ = 12;
/** How long a pedestrian loiters at a wander point before choosing another. */
const WANDER_PAUSE = 4;

interface AmbientSlot {
  agent: NpcAgent;
  /** Seed used for this pedestrian's appearance and destinations. */
  seed: number;
}

export class Population {
  readonly nav = new NavService();
  readonly bus = new PerceptionBus();

  private readonly named: NpcAgent[] = [];
  private readonly ambient: AmbientSlot[] = [];
  private readonly visuals: NpcVisuals | null;
  private traffic: TrafficSystem | null = null;
  private readonly links: OffMeshLink[];
  private readonly rng: () => number;
  private readonly deps: AgentDeps;

  private budget: PopulationBudget;
  private farTimer = 0;
  private farCursor = 0;
  private perceptionTimer = 0;
  private midAnimAccum = 0;
  private lastFarTickMs = 0;
  private disposed = false;
  private active = true;

  /** Barks raised this frame, drained by the HUD. */
  readonly pendingBarks: Array<{ npcId: string; name: string; line: string }> = [];

  constructor(
    private readonly d: PopulationDeps,
    budget: PopulationBudget,
    private readonly seed: number,
    /** World-clock day fraction, so residents start where the hour says. */
    startTime = 0.5,
  ) {
    this.budget = budget;
    this.rng = mulberry32(seed);
    this.links = offMeshLinksForZone(d.zone, d.heightAt);

    // A population without a rig still simulates; it just has nobody to look
    // at. That is the same fallback the player already has when the GLB fails
    // to load, and it keeps a missing asset from taking the schedules with it.
    this.visuals = d.rig.scene ? new NpcVisuals(d.rig.scene, d.rig.clips) : null;
    this.deps = {
      nav: this.nav,
      visuals: this.visuals,
      group: d.group,
      heightAt: (x, z) => d.heightAt(x, z),
    };

    this.spawnNamed(hourOfDay(startTime));
    this.buildTraffic();
  }

  // ------------------------------------------------------------------ setup

  /**
   * Bake the navmesh.
   *
   * Separate from the constructor and deliberately not awaited by it: the
   * population exists and its residents keep to their schedules from the first
   * frame, walking coarse straight-line paths. When the navmesh lands they
   * start using doorways properly and steering around each other. Nothing has
   * to wait for it, and a browser that cannot compile the WASM simply never
   * gets the upgrade.
   */
  async buildNavigation(): Promise<void> {
    const geometry = this.d.collision.collider?.geometry;
    if (!geometry) return;
    const input = navInputFromGeometry(geometry, this.d.zone.bounds, {
      groundAt: (x, z) => this.d.heightAt(x, z),
    });
    if (input.indices.length === 0) return;
    await this.nav.build(input, this.links, this.budget.maxNear + this.budget.maxAmbient + 4);
    if (this.disposed) {
      this.nav.dispose();
      return;
    }
    // Snap everyone onto the mesh now that there is one; an agent standing
    // half a metre inside a wall would otherwise never get a crowd agent.
    for (const agent of this.named) this.snapToNav(agent);
    for (const slot of this.ambient) this.snapToNav(slot.agent);
  }

  private snapToNav(agent: NpcAgent): void {
    const snapped = this.nav.sample(agent.position, 4);
    if (snapped) agent.placeAt(snapped.x, snapped.z);
  }

  /**
   * Put the residents where the clock says they already are.
   *
   * Not at home. Placing everybody on their own doorstep and letting the
   * schedule walk them away looks like a village turning out to watch you
   * arrive, and it had a concrete consequence: all eight village buildings are
   * enterable, so eight residents stood on eight door prompts and the
   * interaction tests started being offered "Talk to Liya" instead of
   * "Go inside".
   */
  private spawnNamed(hour: number): void {
    for (const def of npcsInZone(NPC_CATALOGUE, this.d.zone.id)) {
      const schedule = scheduleById(def.scheduleId);
      const agent = new NpcAgent(def.id, 'named', def, def.appearance, schedule, this.deps);
      agent.placeAt(def.anchors.home.x, def.anchors.home.z);
      agent.applySchedule(hour);
      const at = agent.target;
      if (at) agent.placeAt(at.x, at.z);
      this.seedRelationship(def);
      this.named.push(agent);
    }
  }

  private seedRelationship(def: NamedNpcDefinition): void {
    // Only if the save did not already have one: a restored relationship is
    // the player's history and must not be overwritten by the catalogue's
    // starting values.
    if (this.d.relationships.has(def.id)) return;
    this.d.relationships.set(def.id, def.initialRelationship ?? {});
  }

  /**
   * The lane graph, from whichever description of the roads is better.
   *
   * A zone that supplies `extraCentrelines` **replaces** the manifest's, it
   * does not add to them. The village is the case: its manifest lanes are a
   * nine-node sketch of a 260-point spline, and taking both would give the
   * village two overlapping road networks and cars driving down the one that
   * is not there.
   */
  private buildTraffic(): void {
    const supplied = this.d.extraCentrelines;
    const centrelines =
      supplied && supplied.length > 0
        ? [...supplied]
        : centrelinesFromManifest(this.d.zone, this.d.heightAt);
    if (centrelines.length === 0) return;
    const graph = buildLaneGraph(centrelines);
    if (graph.lanes.length === 0) return;
    this.traffic = new TrafficSystem(
      graph,
      this.d.vehicleModels,
      this.d.group,
      this.seed ^ 0x7a11c,
      this.budget.maxTraffic,
    );
  }

  // ----------------------------------------------------------------- budget

  setBudget(budget: PopulationBudget): void {
    this.budget = budget;
    this.traffic?.setMaxVehicles(budget.maxTraffic);
    while (this.ambient.length > budget.maxAmbient) {
      const slot = this.ambient.pop();
      slot?.agent.dispose();
    }
  }

  // ----------------------------------------------------------------- update

  /**
   * Stop the population moving and take it out of the frame.
   *
   * For measurements about something else. A test asserting that ageing the
   * player adds no draw calls cannot do so against a village of moving
   * pedestrians, and the honest answer is to hold them still rather than to
   * loosen the assertion until it passes.
   */
  setActive(on: boolean): void {
    if (this.active === on) return;
    this.active = on;
    for (const agent of this.named) agent.setVisible(on);
    for (const slot of this.ambient) slot.agent.setVisible(on);
    this.traffic?.setVisible(on);
  }

  get isActive(): boolean {
    return this.active;
  }

  update(
    dt: number,
    worldTime: number,
    player: { position: THREE.Vector3; facing: number },
    playerObstacles: readonly TrafficObstacle[] = [],
  ): void {
    if (this.disposed || !this.active) return;
    const hour = hourOfDay(worldTime);

    this.farTimer += dt;
    if (this.farTimer >= FAR_TICK_SECONDS) {
      this.tickFar(hour);
      this.farTimer = 0;
    }

    this.assignBands(player.position);
    this.maintainAmbient(player, hour);

    // The crowd steps once for everybody, not once per agent.
    this.nav.update(dt);

    this.midAnimAccum += dt;
    const midStep = this.midAnimAccum >= 1 / MID_ANIM_HZ ? this.midAnimAccum : 0;
    if (midStep > 0) this.midAnimAccum = 0;

    for (const agent of this.named) this.updateAgent(agent, dt, midStep);
    for (const slot of this.ambient) this.updateAgent(slot.agent, dt, midStep);

    this.traffic?.update(dt, player.position, player.facing, [
      ...playerObstacles,
      ...this.pedestrianObstacles(),
    ]);

    this.perceptionTimer += dt;
    if (this.perceptionTimer >= PERCEPTION_TICK_SECONDS) {
      this.perceptionTimer = 0;
      this.resolvePerception(hour);
    } else {
      // Events raised between resolves would otherwise pile up unbounded.
      if (this.bus.pending.length > 64) this.bus.clear();
    }
  }

  private updateAgent(agent: NpcAgent, dt: number, midStep: number): void {
    // Mid tier gets the accumulated step so its animation runs at ~12 Hz
    // instead of the frame rate; movement still integrates every frame, or a
    // pedestrian at 60 m would visibly stutter.
    if (agent.band === 'mid' && midStep === 0) {
      agent.update(dt);
      return;
    }
    agent.update(agent.band === 'mid' ? Math.max(dt, midStep) : dt);
  }

  /**
   * Advance the far tier, a bounded slice at a time.
   *
   * The whole point of the far tier is that it costs nothing, so it is capped
   * twice: it runs at 2 Hz rather than per frame, and each run examines at most
   * `farPerTick` residents, resuming where it left off. Twenty residents at
   * eight per tick is a complete sweep every 1.5 seconds — far more often than
   * a schedule changes, and bounded whatever the population becomes.
   */
  private tickFar(hour: number): void {
    const started = performance.now();
    const all = this.named;
    if (all.length === 0) return;

    const count = Math.min(this.budget.farPerTick, all.length);
    for (let i = 0; i < count; i++) {
      const agent = all[(this.farCursor + i) % all.length];
      const changed = agent.applySchedule(hour);
      if (changed && agent.band === 'far') {
        // Nobody is watching, so skip the walk: put them where the schedule
        // says they should be by now rather than animating a 200 m commute
        // that will never be seen.
        const wake = nextTransition(scheduleFor(agent), hour);
        if (wake.inHours > 0.25 && agent.target) {
          agent.placeAt(agent.target.x, agent.target.z);
        }
      }
    }
    this.farCursor = (this.farCursor + count) % all.length;
    this.lastFarTickMs = performance.now() - started;
  }

  /**
   * Decide who gets which tier.
   *
   * Two stages: each agent's own hysteresis picks a band from distance, then
   * the near band is capped and the surplus demoted. The cap has to come second
   * or a crowd of pedestrians round a corner could evict the resident the
   * player is mid-conversation with.
   */
  private assignBands(player: THREE.Vector3): void {
    const candidates: Array<{ id: string; distance: number; named: boolean; agent: NpcAgent }> = [];

    const consider = (agent: NpcAgent, named: boolean) => {
      const distance = Math.hypot(agent.position.x - player.x, agent.position.z - player.z);
      const band = bandFor(distance, agent.band, this.budget.lod);
      if (band === 'near') candidates.push({ id: agent.id, distance, named, agent });
      else agent.setBand(band);
    };

    for (const agent of this.named) consider(agent, true);
    for (const slot of this.ambient) consider(slot.agent, false);

    const promoted = rankForNear(candidates, this.budget.maxNear);
    for (const c of candidates) {
      c.agent.setBand(promoted.has(c.id) ? 'near' : 'mid');
    }
  }

  // ---------------------------------------------------------------- ambient

  /**
   * Keep the pavement populated.
   *
   * Pedestrians are spawned in the zone's ambient areas, never in the player's
   * view, and are recycled rather than destroyed: a pedestrian who walks out of
   * the bubble is re-seeded somewhere else with a new appearance, which costs a
   * colour swap instead of a skeleton.
   */
  private maintainAmbient(player: { position: THREE.Vector3; facing: number }, hour: number): void {
    const areas = this.d.zone.ambientAreas;
    if (areas.length === 0 || !this.visuals) return;

    // Fewer people out at night, and none at all in the small hours. A street
    // with the same crowd at 04:00 as at midday is the clearest possible tell
    // that the schedule system stops at the named residents.
    const nightFactor = hour < 5 || hour > 22.5 ? 0.12 : hour < 7 || hour > 20 ? 0.45 : 1;
    const wanted = Math.round(this.budget.maxAmbient * nightFactor);

    for (let i = this.ambient.length - 1; i >= 0; i--) {
      const slot = this.ambient[i];
      const distance = Math.hypot(
        slot.agent.position.x - player.position.x,
        slot.agent.position.z - player.position.z,
      );
      if (distance > this.budget.lod.mid + 60 || this.ambient.length > wanted) {
        slot.agent.dispose();
        this.ambient.splice(i, 1);
        continue;
      }
      if (slot.agent.arrived && slot.agent.waiting > WANDER_PAUSE) {
        slot.agent.resetWait();
        this.sendWandering(slot);
      }
    }

    let attempts = 0;
    while (this.ambient.length < wanted && attempts++ < 3) {
      const area = areas[Math.floor(this.rng() * areas.length) % areas.length];
      const angle = this.rng() * Math.PI * 2;
      const radius = Math.sqrt(this.rng()) * area.radius;
      const x = area.x + Math.cos(angle) * radius;
      const z = area.z + Math.sin(angle) * radius;

      const distance = Math.hypot(x - player.position.x, z - player.position.z);
      if (distance < 24) continue;
      if (distance < 70 && inCone(player, x, z)) continue;

      const seed = (this.seed ^ Math.floor(this.rng() * 0xffffff)) >>> 0;
      const agent = new NpcAgent(
        `amb_${seed.toString(36)}`,
        'ambient',
        null,
        ambientAppearance(seed),
        null,
        this.deps,
      );
      agent.placeAt(x, z);
      const slot: AmbientSlot = { agent, seed };
      this.ambient.push(slot);
      this.sendWandering(slot);
    }
  }

  private sendWandering(slot: AmbientSlot): void {
    const areas = this.d.zone.ambientAreas;
    if (areas.length === 0) return;
    const area = areas[Math.floor(this.rng() * areas.length) % areas.length];
    const angle = this.rng() * Math.PI * 2;
    const radius = Math.sqrt(this.rng()) * area.radius;
    let x = area.x + Math.cos(angle) * radius;
    let z = area.z + Math.sin(angle) * radius;

    // Route via a marked crossing when the walk would otherwise cut across a
    // carriageway. Kerbs are 14 cm and the navmesh happily walks over them, so
    // without this everybody jaywalks and the crossings are decoration.
    const crossing = preferredCrossing(slot.agent.position, { x, y: 0, z }, this.links);
    if (crossing) {
      const nearer =
        Math.hypot(crossing.start.x - slot.agent.position.x, crossing.start.z - slot.agent.position.z) <
        Math.hypot(crossing.end.x - slot.agent.position.x, crossing.end.z - slot.agent.position.z)
          ? crossing.end
          : crossing.start;
      x = nearer.x;
      z = nearer.z;
    }

    slot.agent.setDestination(x, z);
  }

  private pedestrianObstacles(): TrafficObstacle[] {
    const out: TrafficObstacle[] = [];
    for (const agent of this.named) {
      if (agent.band === 'near' && !agent.indoors) {
        out.push({ x: agent.position.x, z: agent.position.z, radius: 0.6 });
      }
    }
    for (const slot of this.ambient) {
      if (slot.agent.band === 'near' && !slot.agent.indoors) {
        out.push({ x: slot.agent.position.x, z: slot.agent.position.z, radius: 0.6 });
      }
    }
    return out;
  }

  // ------------------------------------------------------------- perception

  /** Raise an event for anybody nearby to notice. */
  emit(
    kind: PerceptionKind,
    at: THREE.Vector3,
    actor = 'player',
    opts?: { loudness?: number; severity?: number; criminal?: boolean },
  ): void {
    this.bus.emit(kind, at, actor, opts);
  }

  private resolvePerception(hour: number): void {
    const observers: Observer[] = [];
    const byId = new Map<string, NpcAgent>();

    const add = (agent: NpcAgent) => {
      if (agent.band !== 'near' || agent.indoors) return;
      observers.push({
        id: agent.id,
        eye: { x: agent.position.x, y: agent.position.y + 1.6, z: agent.position.z },
        facing: agent.facing,
        sightRange: DEFAULT_SENSES.sightRange,
        fov: DEFAULT_SENSES.fov,
        hearingRange: DEFAULT_SENSES.hearingRange,
      });
      byId.set(agent.id, agent);
    };

    for (const agent of this.named) add(agent);
    for (const slot of this.ambient) add(slot.agent);
    if (observers.length === 0) {
      this.bus.clear();
      return;
    }

    const witnesses = this.bus.resolve(observers, (from, to) => this.occluded(from, to));
    for (const w of witnesses) this.applyWitness(w, byId, hour);
  }

  /**
   * Does anything solid sit between these two points?
   *
   * One BVH ray against the zone's collision proxy — the same geometry the
   * player collides with, so what blocks a shoulder blocks a line of sight.
   * The `- 0.35` shortens the ray so a wall the observer is leaning against
   * does not count as blocking their view of themselves.
   */
  private occluded(from: { x: number; y: number; z: number }, to: { x: number; y: number; z: number }): boolean {
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dz = to.z - from.z;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 0.5) return false;

    _origin.set(from.x, from.y, from.z);
    _dir.set(dx / distance, dy / distance, dz / distance);
    const hit = this.d.collision.raycast(_origin, _dir, distance - 0.35);
    return hit !== null;
  }

  private applyWitness(w: Witness, byId: Map<string, NpcAgent>, hour: number): void {
    const agent = byId.get(w.observerId);
    if (!agent) return;

    const rel = agent.definition
      ? this.d.relationships.get(agent.definition.id)
      : { familiarity: 0, trust: 0, affection: 0, fear: 0, respect: 0 };

    const reaction = chooseReaction({
      kind: w.event.kind,
      confidence: w.perception.confidence,
      distance: w.perception.distance,
      fear: rel.fear,
      familiarity: rel.familiarity,
    });

    agent.react(reaction, w.event.at);

    if (reaction === 'greet' && agent.definition) {
      this.d.relationships.greet(agent.definition.id);
      const line = barkFor(agent.definition.barkSet, hour);
      if (line) {
        this.pendingBarks.push({
          npcId: agent.definition.id,
          name: agent.definition.displayName,
          line,
        });
      }
    }
  }

  // ------------------------------------------------------------- birthdays

  /**
   * A year has passed for the player, so it has passed for everyone.
   *
   * Named residents only. Ambient pedestrians are not remodelled — they are
   * pooled strangers with no identity to age, and rebuilding forty bodies for a
   * birthday nobody would notice is exactly the cost this system exists to
   * avoid.
   */
  advanceYear(): void {
    for (const agent of this.named) agent.advanceAge(1);
  }

  /** Ages of the named residents, for saving. */
  ageSnapshot(): Array<{ id: string; age: number }> {
    return this.named
      .map((a) => ({ id: a.id, age: a.age }))
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  }

  restoreAges(rows: readonly { id: string; age: number }[] | undefined): void {
    if (!rows) return;
    const byId = new Map(rows.map((r) => [r.id, r.age]));
    for (const agent of this.named) {
      const age = byId.get(agent.id);
      if (typeof age === 'number' && Number.isFinite(age)) {
        agent.advanceAge(age - agent.age);
      }
    }
  }

  // ------------------------------------------------------------ inspection

  /** The named resident nearest the player within `radius`, for interaction. */
  nearestNamed(to: THREE.Vector3, radius: number): NpcAgent | null {
    let best: NpcAgent | null = null;
    let bestDistance = radius;
    for (const agent of this.named) {
      if (agent.indoors) continue;
      const d = Math.hypot(agent.position.x - to.x, agent.position.z - to.z);
      if (d < bestDistance) {
        bestDistance = d;
        best = agent;
      }
    }
    return best;
  }

  namedById(id: string): NpcAgent | null {
    return this.named.find((a) => a.id === id) ?? null;
  }

  /** Named residents in catalogue order. Read-only to callers. */
  namedList(): readonly NpcAgent[] {
    return this.named;
  }

  trafficPositions(): readonly TrafficObstacle[] {
    return this.traffic?.positions() ?? [];
  }

  get stats(): PopulationStats {
    let near = 0;
    let mid = 0;
    let far = 0;
    let bodies = 0;
    let recoveries = 0;
    const tally = (a: NpcAgent) => {
      const band: LodBand = a.band;
      if (band === 'near') near++;
      else if (band === 'mid') mid++;
      else far++;
      if (a.hasBody) bodies++;
      recoveries += a.stats.stuckRecoveries;
    };
    for (const a of this.named) tally(a);
    for (const s of this.ambient) tally(s.agent);

    const navStats = this.nav.stats;
    return {
      named: this.named.length,
      ambient: this.ambient.length,
      near,
      mid,
      far,
      bodies,
      navState: this.nav.status,
      navBuildMs: navStats?.buildMs ?? 0,
      navAgents: navStats?.agents ?? 0,
      offMeshLinks: this.links.length,
      traffic: this.traffic?.stats.vehicles ?? 0,
      trafficParked: this.traffic?.stats.parked ?? 0,
      trafficBarges: this.traffic?.stats.barges ?? 0,
      witnessed: this.bus.witnessed,
      stuckRecoveries: recoveries,
      farTickMs: Math.round(this.lastFarTickMs * 100) / 100,
    };
  }

  dispose(): void {
    this.disposed = true;
    for (const agent of this.named) agent.dispose();
    for (const slot of this.ambient) slot.agent.dispose();
    this.named.length = 0;
    this.ambient.length = 0;
    this.traffic?.dispose();
    this.traffic = null;
    this.visuals?.dispose();
    this.bus.clear();
    this.nav.dispose();
    this.pendingBarks.length = 0;
  }
}

const _origin = new THREE.Vector3();
const _dir = new THREE.Vector3();

function inCone(player: { position: THREE.Vector3; facing: number }, x: number, z: number): boolean {
  const bearing = Math.atan2(x - player.position.x, z - player.position.z);
  let delta = (bearing - player.facing) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta <= -Math.PI) delta += Math.PI * 2;
  return Math.abs(delta) < (80 * Math.PI) / 180;
}

function scheduleFor(agent: NpcAgent) {
  const id = agent.definition?.scheduleId ?? '';
  return scheduleById(id) ?? { id: 'none', blocks: [{ from: 0, kind: 'home' as const, place: 'home' as const }] };
}

function barkFor(setId: string, hour: number): string | null {
  // Salted with the hour, so somebody greeted twice in a minute says the same
  // thing and somebody greeted tomorrow does not.
  const situation = hour < 6 || hour > 22 ? 'night' : 'greet';
  return pickBark(setId, situation, Math.floor(hour));
}
